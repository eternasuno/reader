package httpserver

import (
	"container/list"
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
	loginOverflowLimit = loginFailureLimit
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

type loginWindow struct {
	started  time.Time
	failures int
}

func (w loginWindow) isLive(now time.Time) bool {
	return w.failures > 0 && now.Sub(w.started) < loginFailureWindow
}

func (w *loginWindow) reserve(now time.Time, limit int) bool {
	if !w.isLive(now) {
		*w = loginWindow{started: now, failures: 1}

		return true
	}

	if w.failures >= limit {
		return false
	}

	w.failures++

	return true
}

type loginEntry struct {
	ip     string
	window loginWindow
}

type loginLimiter struct {
	mu       sync.Mutex
	now      func() time.Time
	attempts map[string]*list.Element
	order    *list.List
	overflow loginWindow
}

func newLoginLimiter(now func() time.Time) *loginLimiter {
	return &loginLimiter{
		now:      now,
		attempts: make(map[string]*list.Element),
		order:    list.New(),
	}
}

// reserveAttempt checks and records a login attempt for ip under one lock, so
// concurrent requests from a single address cannot race past loginFailureLimit.
// The attempt is counted as a failure up front; reset clears it after a success.
func (l *loginLimiter) reserveAttempt(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	if entry, ok := l.liveEntryLocked(ip, now); ok {
		return entry.window.reserve(now, loginFailureLimit)
	}

	// Keep untracked addresses in the active overflow window even if tracked
	// slots open up via success or expiry, preventing rotating/blocked callers
	// from acquiring a fresh per-IP allowance until the overflow window elapses.
	if l.overflow.isLive(now) {
		return l.overflow.reserve(now, loginOverflowLimit)
	}

	if len(l.attempts) >= maxTrackedLoginIPs {
		l.pruneExpiredLocked(now)
	}

	if len(l.attempts) >= maxTrackedLoginIPs {
		return l.overflow.reserve(now, loginOverflowLimit)
	}

	entry := &loginEntry{
		ip:     ip,
		window: loginWindow{started: now, failures: 1},
	}
	l.attempts[ip] = l.order.PushBack(entry)

	return true
}

func (l *loginLimiter) reset(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	if elem, tracked := l.attempts[ip]; tracked {
		l.removeElementLocked(elem)
	}
}

// liveEntryLocked returns the unexpired failure window for ip, dropping it when
// the window has elapsed.
func (l *loginLimiter) liveEntryLocked(ip string, now time.Time) (*loginEntry, bool) {
	elem, tracked := l.attempts[ip]
	if !tracked {
		return nil, false
	}

	entry, ok := elem.Value.(*loginEntry)
	if !ok || !entry.window.isLive(now) {
		l.removeElementLocked(elem)

		return nil, false
	}

	return entry, true
}

func (l *loginLimiter) pruneExpiredLocked(now time.Time) {
	for front := l.order.Front(); front != nil; {
		entry, ok := front.Value.(*loginEntry)
		if ok && entry.window.isLive(now) {
			break
		}

		next := front.Next()
		l.removeElementLocked(front)
		front = next
	}
}

func (l *loginLimiter) removeElementLocked(elem *list.Element) {
	if entry, ok := elem.Value.(*loginEntry); ok {
		delete(l.attempts, entry.ip)
	}

	l.order.Remove(elem)
}
