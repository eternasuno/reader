package httpserver

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

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
	if err := decodeJSON(w, r, &req); err != nil {
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
	if parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil ||
		parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Opaque != "" {
		return false
	}

	return sameOrigin(parsed, s.appURL)
}

func (s *server) validateRefererHeader(raw string) bool {
	rawReferer := strings.TrimSpace(raw)
	if rawReferer == "" {
		return false
	}

	parsed, err := url.Parse(rawReferer)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil {
		return false
	}

	return sameOrigin(parsed, s.appURL)
}

func sameOrigin(left *url.URL, right *url.URL) bool {
	if !strings.EqualFold(left.Scheme, right.Scheme) {
		return false
	}

	if !strings.EqualFold(left.Hostname(), right.Hostname()) {
		return false
	}

	return effectivePort(left) == effectivePort(right)
}

func effectivePort(u *url.URL) string {
	if port := u.Port(); port != "" {
		return port
	}

	switch strings.ToLower(u.Scheme) {
	case "http":
		return "80"
	case "https":
		return "443"
	default:
		return ""
	}
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

type loginLimiter struct {
	mu       sync.Mutex
	now      func() time.Time
	attempts map[string]loginWindow
}

func newLoginLimiter(now func() time.Time) *loginLimiter {
	return &loginLimiter{now: now, attempts: make(map[string]loginWindow)}
}

// reserveAttempt checks and records a login attempt for ip under one lock, so
// concurrent requests from a single address cannot race past loginFailureLimit.
// The attempt is counted as a failure up front; reset clears it after a success.
func (l *loginLimiter) reserveAttempt(ip string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()

	window, tracked := l.liveWindowLocked(ip, now)
	if !tracked {
		l.storeLocked(ip, now, loginWindow{started: now, failures: 1})

		return true
	}

	if window.failures >= loginFailureLimit {
		return false
	}

	window.failures++
	l.attempts[ip] = window

	return true
}

func (l *loginLimiter) reset(ip string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	delete(l.attempts, ip)
}

// liveWindowLocked returns the unexpired failure window for ip, dropping it when
// the window has elapsed.
func (l *loginLimiter) liveWindowLocked(ip string, now time.Time) (loginWindow, bool) {
	window, tracked := l.attempts[ip]
	if !tracked {
		return loginWindow{}, false
	}

	if now.Sub(window.started) >= loginFailureWindow {
		delete(l.attempts, ip)

		return loginWindow{}, false
	}

	return window, true
}

// storeLocked writes a window while keeping the tracked-IP table strictly
// bounded at maxTrackedLoginIPs: expired windows are pruned first and the oldest
// entry is evicted when every remaining entry is still unexpired.
func (l *loginLimiter) storeLocked(ip string, now time.Time, window loginWindow) {
	if _, tracked := l.attempts[ip]; !tracked && len(l.attempts) >= maxTrackedLoginIPs {
		l.pruneExpiredLocked(now)

		for len(l.attempts) >= maxTrackedLoginIPs {
			l.evictOldestLocked()
		}
	}

	l.attempts[ip] = window
}

func (l *loginLimiter) pruneExpiredLocked(now time.Time) {
	for ip, window := range l.attempts {
		if now.Sub(window.started) >= loginFailureWindow {
			delete(l.attempts, ip)
		}
	}
}

func (l *loginLimiter) evictOldestLocked() {
	oldestIP := ""
	oldestStarted := time.Time{}
	found := false

	for ip, window := range l.attempts {
		if !found || window.started.Before(oldestStarted) {
			oldestIP, oldestStarted, found = ip, window.started, true
		}
	}

	if found {
		delete(l.attempts, oldestIP)
	}
}
