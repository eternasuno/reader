package httpserver

import (
	"container/heap"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"reader/internal/domain"
)

const (
	sessionCookieName  = "reader_session"
	sessionTTL         = 30 * 24 * time.Hour
	loginFailureLimit  = 5
	loginFailureWindow = time.Minute
	maxTrackedLoginIPs = 1024
)

type sessionResponse struct {
	Authenticated bool `json:"authenticated"`
}

type loginRequest struct {
	Password string `json:"password"`
}

// ValidateAppPassword checks that the browser can submit the configured password.
func ValidateAppPassword(password string) error {
	if password == "" || !utf8.ValidString(password) {
		return errors.New("http: APP_PASSWORD must be nonempty valid UTF-8")
	}

	if strings.ContainsAny(password, "\r\n") {
		return errors.New("http: APP_PASSWORD must not contain CR or LF because browsers strip them from password inputs")
	}

	// JSON.stringify leaves HTML characters and Unicode line separators unescaped.
	size := len(`{"password":""}`)
	for _, r := range password {
		size += jsonRuneSize(r)
	}

	if size > maxLoginBodyBytes {
		return fmt.Errorf("http: APP_PASSWORD is too long: its JSON login request exceeds %d bytes", maxLoginBodyBytes)
	}

	return nil
}

func jsonRuneSize(r rune) int {
	switch {
	case r == '"', r == '\\', r == '\b', r == '\f', r == '\t':
		return 2
	case r < 0x20:
		return 6
	default:
		return utf8.RuneLen(r)
	}
}

func (s *server) handleSession(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, sessionResponse{Authenticated: s.hasValidSession(r)})
}

func (s *server) handleLogin(w http.ResponseWriter, r *http.Request) {
	client := clientIP(r)
	if !s.limiter.reserveAttempt(client) {
		writeError(w, domain.NewError(domain.ErrTooManyRequests, nil))

		return
	}

	var req loginRequest
	if err := decodeJSONWithLimit(w, r, maxLoginBodyBytes, &req); err != nil {
		writeError(w, err)

		return
	}

	if !passwordMatches(s.cfg.AppPassword, req.Password) {
		writeError(w, domain.NewError(domain.ErrInvalidCredentials, nil))

		return
	}

	s.limiter.reset(client)
	now := s.cfg.Now()
	http.SetCookie(w, s.sessionCookie(s.signSession(now), now))
	writeNoContent(w)
}

func (s *server) handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   s.secure,
		SameSite: http.SameSiteLaxMode,
	})
	writeNoContent(w)
}

func passwordMatches(appPassword string, submitted string) bool {
	if submitted == "" {
		return false
	}

	expected := sha256.Sum256([]byte(appPassword))
	actual := sha256.Sum256([]byte(submitted))

	return subtle.ConstantTimeCompare(expected[:], actual[:]) == 1
}

func (s *server) sessionCookie(value string, now time.Time) *http.Cookie {
	return &http.Cookie{
		Name:     sessionCookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   int(sessionTTL / time.Second),
		Expires:  now.Add(sessionTTL),
		HttpOnly: true,
		Secure:   s.secure,
		SameSite: http.SameSiteLaxMode,
	}
}

func (s *server) signSession(now time.Time) string {
	expires := strconv.FormatInt(now.Add(sessionTTL).Unix(), 10)

	return expires + "." + hex.EncodeToString(s.sessionMAC(expires))
}

func (s *server) sessionMAC(expires string) []byte {
	mac := hmac.New(sha256.New, s.cfg.SessionSecret)
	mac.Write([]byte("session:" + expires))

	return mac.Sum(nil)
}

func (s *server) hasValidSession(r *http.Request) bool {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return false
	}

	return s.validSessionValue(cookie.Value)
}

func (s *server) validSessionValue(value string) bool {
	expires, signature, found := strings.Cut(value, ".")
	if !found {
		return false
	}

	expiresUnix, err := strconv.ParseInt(expires, 10, 64)
	if err != nil {
		return false
	}

	provided, err := hex.DecodeString(signature)
	if err != nil {
		return false
	}

	if !hmac.Equal(provided, s.sessionMAC(expires)) {
		return false
	}

	return s.cfg.Now().Unix() < expiresUnix
}

func (s *server) originAllowed(r *http.Request) bool {
	// An Origin header is authoritative whenever it is present, even when it is
	// empty: falling back to Referer would let a request with a deliberately
	// blank Origin borrow the referer's origin.
	if originValues, hasOrigin := r.Header["Origin"]; hasOrigin {
		return s.validateOriginHeader(originValues)
	}

	return s.validateRefererHeader(r.Header.Get("Referer"))
}

func (s *server) validateOriginHeader(values []string) bool {
	if len(values) != 1 {
		return false
	}

	rawOrigin := strings.TrimSpace(values[0])
	if rawOrigin == "" || strings.EqualFold(rawOrigin, "null") {
		return false
	}

	parsed, err := url.Parse(rawOrigin)
	if err != nil {
		return false
	}

	// A serialized origin is scheme://host[:port] only, so any userinfo,
	// path, query, fragment, or opaque part means the header is forged.
	if parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Opaque != "" {
		return false
	}

	origin, ok := domain.OriginFromURL(parsed)

	return ok && origin == s.appOrigin
}

func (s *server) validateRefererHeader(raw string) bool {
	rawReferer := strings.TrimSpace(raw)
	if rawReferer == "" {
		return false
	}

	parsed, err := url.Parse(rawReferer)
	if err != nil || parsed.User != nil {
		return false
	}

	origin, ok := domain.OriginFromURL(parsed)

	return ok && origin == s.appOrigin
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}

	return host
}

type loginEntry struct {
	ip       string
	started  time.Time
	failures int
	index    int
}

type loginExpiryHeap []*loginEntry

func (h loginExpiryHeap) Len() int { return len(h) }

func (h loginExpiryHeap) Less(i int, j int) bool {
	return h[i].started.Before(h[j].started)
}

func (h loginExpiryHeap) Swap(i int, j int) {
	h[i], h[j] = h[j], h[i]
	h[i].index = i
	h[j].index = j
}

func (h *loginExpiryHeap) Push(x any) {
	entry, ok := x.(*loginEntry)
	if !ok {
		return
	}

	entry.index = len(*h)
	*h = append(*h, entry)
}

func (h *loginExpiryHeap) Pop() any {
	old := *h
	n := len(old)
	entry := old[n-1]
	old[n-1] = nil
	entry.index = -1
	*h = old[:n-1]

	return entry
}

type loginLimiter struct {
	mu       sync.Mutex
	now      func() time.Time
	attempts map[string]*loginEntry
	order    loginExpiryHeap
}

func newLoginLimiter(now func() time.Time) *loginLimiter {
	return &loginLimiter{now: now, attempts: make(map[string]*loginEntry)}
}

// reserveAttempt checks and records a login attempt for ip under one lock, so
// concurrent requests from a single address cannot race past loginFailureLimit.
// The attempt is counted as a failure up front; reset clears it after a success.
func (l *loginLimiter) reserveAttempt(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()

	entry, tracked := l.liveEntryLocked(ip, now)
	if !tracked {
		l.storeLocked(ip, now)

		return true
	}

	if entry.failures >= loginFailureLimit {
		return false
	}

	entry.failures++

	return true
}

func (l *loginLimiter) reset(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	l.deleteLocked(ip)
}

// liveEntryLocked returns the unexpired failure window for ip, dropping it when
// the window has elapsed.
func (l *loginLimiter) liveEntryLocked(ip string, now time.Time) (*loginEntry, bool) {
	entry, tracked := l.attempts[ip]
	if !tracked {
		return nil, false
	}

	if now.Sub(entry.started) >= loginFailureWindow {
		l.deleteLocked(ip)

		return nil, false
	}

	return entry, true
}

func (l *loginLimiter) deleteLocked(ip string) {
	entry, tracked := l.attempts[ip]
	if !tracked {
		return
	}

	if entry.index >= 0 {
		heap.Remove(&l.order, entry.index)
	}

	delete(l.attempts, ip)
}

// storeLocked writes a new window while keeping the tracked-IP table strictly
// bounded at maxTrackedLoginIPs: expired windows are pruned first and the oldest
// entry is evicted when every remaining entry is still unexpired.
func (l *loginLimiter) storeLocked(ip string, now time.Time) {
	if len(l.attempts) >= maxTrackedLoginIPs {
		l.pruneExpiredLocked(now)

		for len(l.attempts) >= maxTrackedLoginIPs {
			l.evictOldestLocked()
		}
	}

	entry := &loginEntry{ip: ip, started: now, failures: 1}
	heap.Push(&l.order, entry)
	l.attempts[ip] = entry
}

func (l *loginLimiter) pruneExpiredLocked(now time.Time) {
	for l.order.Len() > 0 && now.Sub(l.order[0].started) >= loginFailureWindow {
		l.evictOldestLocked()
	}
}

func (l *loginLimiter) evictOldestLocked() {
	if l.order.Len() == 0 {
		return
	}

	if oldest, ok := heap.Pop(&l.order).(*loginEntry); ok {
		delete(l.attempts, oldest.ip)
	}
}
