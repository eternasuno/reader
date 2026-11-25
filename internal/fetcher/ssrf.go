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

	"reader/internal/domain"
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
		netip.MustParsePrefix("64:ff9b::/96"),
		netip.MustParsePrefix("64:ff9b:1::/48"),
		netip.MustParsePrefix("fc00::/7"),
		netip.MustParsePrefix("fe80::/10"),
		netip.MustParsePrefix("ff00::/8"),
	}
)

func IsBlockedIP(addr netip.Addr) bool {
	addr = addr.Unmap().WithZone("")
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

func newBrowserDiscoveryClient() *http.Client {
	client := newHTTPClient(true)
	client.CheckRedirect = browserDiscoveryRedirectPolicy

	return client
}

func browserDiscoveryRedirectPolicy(req *http.Request, via []*http.Request) error {
	if err := redirectPolicy(req, via); err != nil {
		return err
	}

	if len(via) == 0 || via[0] == nil {
		return errBadRedirectURL
	}

	origin, ok := domain.OriginFromURL(via[0].URL)
	if !ok || breaksAuthScope(req, origin) {
		return errBadRedirectURL
	}

	req.Header.Del("Referer")

	return nil
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
	if len(via) == 0 || via[0] == nil {
		return true
	}

	initialOrigin, ok := domain.OriginFromURL(via[0].URL)
	if !ok {
		return true
	}

	for _, hop := range via[1:] {
		if breaksAuthScope(hop, initialOrigin) {
			return true
		}
	}

	return breaksAuthScope(next, initialOrigin)
}

func breaksAuthScope(req *http.Request, initialOrigin domain.Origin) bool {
	if req == nil {
		return true
	}

	origin, ok := domain.OriginFromURL(req.URL)
	if !ok {
		return true
	}

	return origin != initialOrigin
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

	return domain.SanitizeErrorText(stripped.String())
}
