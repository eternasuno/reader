package fetcher

import (
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"syscall"
	"time"
)

const (
	dialTimeout         = 10 * time.Second
	tlsHandshakeTimeout = 10 * time.Second
	idleConnTimeout     = 30 * time.Second
	maxIdleConns        = 32
	maxIdleConnsPerHost = 4
	maxRedirects        = 10
)

var (
	errBlockedAddress   = errors.New("blocked non-public address")
	errInvalidDialAddr  = errors.New("invalid dial address")
	errResponseTooLarge = errors.New("response body too large")
	errTooManyRedirects = errors.New("stopped after 10 redirects")
	errBadRedirectURL   = errors.New("redirect target must be an absolute http or https url")

	blockedPrefixes = []netip.Prefix{
		netip.MustParsePrefix("0.0.0.0/8"),
		netip.MustParsePrefix("100.64.0.0/10"),
		netip.MustParsePrefix("192.0.0.0/24"),
		netip.MustParsePrefix("198.18.0.0/15"),
		netip.MustParsePrefix("240.0.0.0/4"),
		netip.MustParsePrefix("255.255.255.255/32"),
		netip.MustParsePrefix("fc00::/7"),
		netip.MustParsePrefix("fe80::/10"),
		netip.MustParsePrefix("ff00::/8"),
	}
)

func IsBlockedIP(addr netip.Addr) bool {
	addr = addr.Unmap()
	if !addr.IsValid() {
		return true
	}

	if !addr.IsGlobalUnicast() {
		return true
	}

	if addr.IsUnspecified() || addr.IsLoopback() || addr.IsPrivate() {
		return true
	}

	if addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() || addr.IsMulticast() {
		return true
	}

	for _, prefix := range blockedPrefixes {
		if prefix.Contains(addr) {
			return true
		}
	}

	return false
}

func checkDialAddress(address string) error {
	addrPort, err := netip.ParseAddrPort(address)
	if err != nil {
		return errInvalidDialAddr
	}

	if IsBlockedIP(addrPort.Addr()) {
		return errBlockedAddress
	}

	return nil
}

func newHTTPClient(allowPrivateNetwork bool) *http.Client {
	return newHTTPClientWithDialCheck(func(address string) error {
		if allowPrivateNetwork {
			return nil
		}

		return checkDialAddress(address)
	})
}

func newHTTPClientWithDialCheck(check func(address string) error) *http.Client {
	dialer := &net.Dialer{
		Timeout:   dialTimeout,
		KeepAlive: idleConnTimeout,
	}
	dialer.Control = func(network string, address string, conn syscall.RawConn) error {
		return check(address)
	}

	transport := &http.Transport{
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          maxIdleConns,
		MaxIdleConnsPerHost:   maxIdleConnsPerHost,
		IdleConnTimeout:       idleConnTimeout,
		TLSHandshakeTimeout:   tlsHandshakeTimeout,
		ExpectContinueTimeout: time.Second,
	}

	return &http.Client{
		Transport:     transport,
		CheckRedirect: redirectPolicy,
	}
}

func redirectPolicy(req *http.Request, via []*http.Request) error {
	if len(via) >= maxRedirects {
		return errTooManyRedirects
	}

	if req.URL == nil {
		return errBadRedirectURL
	}

	scheme := strings.ToLower(req.URL.Scheme)
	if scheme != "http" && scheme != "https" {
		return errBadRedirectURL
	}

	if req.URL.Hostname() == "" {
		return errBadRedirectURL
	}

	if len(via) > 0 && shouldStripAuthorization(via, req) {
		req.Header.Del("Authorization")
	}

	return nil
}

func shouldStripAuthorization(via []*http.Request, next *http.Request) bool {
	if len(via) == 0 || via[0] == nil || via[0].URL == nil {
		return true
	}

	initialURL := via[0].URL
	initialOrigin := requestOrigin(initialURL)
	initialHTTPS := strings.EqualFold(initialURL.Scheme, "https")

	for _, hop := range via[1:] {
		if breaksAuthScope(hop, initialOrigin, initialHTTPS) {
			return true
		}
	}

	return breaksAuthScope(next, initialOrigin, initialHTTPS)
}

func breaksAuthScope(req *http.Request, initialOrigin string, initialHTTPS bool) bool {
	if req == nil || req.URL == nil {
		return true
	}

	if requestOrigin(req.URL) != initialOrigin {
		return true
	}

	return initialHTTPS && strings.EqualFold(req.URL.Scheme, "http")
}

func requestOrigin(parsed *url.URL) string {
	scheme := strings.ToLower(parsed.Scheme)
	port := parsed.Port()
	if port == "" {
		switch scheme {
		case "http":
			port = "80"
		case "https":
			port = "443"
		}
	}

	return scheme + "://" + strings.ToLower(parsed.Hostname()) + ":" + port
}

func readLimitedBody(reader io.Reader, maxBytes int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return nil, err
	}

	if int64(len(data)) > maxBytes {
		return nil, errResponseTooLarge
	}

	return data, nil
}

func sanitizedURL(parsed *url.URL) string {
	if parsed == nil {
		return ""
	}

	stripped := *parsed
	stripped.User = nil

	return stripCredentialText(stripped.String())
}
