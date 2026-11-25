package fetcher

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"reader/internal/domain"
	"strings"
	"sync/atomic"
	"testing"
)

func TestIsBlockedIP(t *testing.T) {
	blocked := []string{
		"127.0.0.1",
		"10.0.0.1",
		"172.16.0.1",
		"192.168.1.1",
		"169.254.169.254",
		"100.64.0.1",
		"0.0.0.0",
		"224.0.0.1",
		"198.18.0.1",
		"255.255.255.255",
		"::1",
		"fe80::1",
		"fe80::1%eth0",
		"::",
		"192.0.0.1",
		"240.0.0.1",
		"fc00::1",
		"ff02::1",
		"64:ff9b::127.0.0.1",
		"64:ff9b::192.0.2.1",
		"64:ff9b:1::1",
		"64:ff9b:1:ffff::1",
		"::ffff:127.0.0.1",
		"::ffff:10.0.0.1",
	}

	for _, raw := range blocked {
		t.Run(raw, func(t *testing.T) {
			addr, err := netip.ParseAddr(raw)
			if err != nil {
				t.Fatalf("parse %q: %v", raw, err)
			}

			if !IsBlockedIP(addr) {
				t.Fatalf("expected %s to be blocked", raw)
			}
		})
	}

	allowed := []string{
		"93.184.216.34",
		"2606:2800:220:1:248:1893:25c8:1946",
		"2606:2800:220:1:248:1893:25c8:1946%eth0",
		"64:ff9c::1",
		"8.8.8.8",
		"1.1.1.1",
	}

	for _, raw := range allowed {
		t.Run(raw, func(t *testing.T) {
			addr, err := netip.ParseAddr(raw)
			if err != nil {
				t.Fatalf("parse %q: %v", raw, err)
			}

			if IsBlockedIP(addr) {
				t.Fatalf("expected %s to be allowed", raw)
			}
		})
	}

	if !IsBlockedIP(netip.Addr{}) {
		t.Fatal("expected invalid address to be blocked")
	}
}

func TestCheckDialAddress(t *testing.T) {
	if err := checkDialAddress("127.0.0.1:80"); !errors.Is(err, errBlockedAddress) {
		t.Fatalf("expected loopback dial to be blocked, got %v", err)
	}

	if err := checkDialAddress("[fe80::1]:443"); !errors.Is(err, errBlockedAddress) {
		t.Fatalf("expected link-local dial to be blocked, got %v", err)
	}

	if err := checkDialAddress("169.254.169.254:80"); !errors.Is(err, errBlockedAddress) {
		t.Fatalf("expected metadata address dial to be blocked, got %v", err)
	}

	if err := checkDialAddress("93.184.216.34:443"); err != nil {
		t.Fatalf("expected public dial to be allowed, got %v", err)
	}

	if err := checkDialAddress("93.184.216.34"); !errors.Is(err, errInvalidDialAddr) {
		t.Fatalf("expected portless address to be rejected, got %v", err)
	}
}

func TestRedirectPolicy(t *testing.T) {
	newRequest := func(t *testing.T, raw string) *http.Request {
		t.Helper()

		req, err := http.NewRequest(http.MethodGet, raw, nil)
		if err != nil {
			t.Fatalf("new request %q: %v", raw, err)
		}

		return req
	}

	t.Run("too many redirects", func(t *testing.T) {
		via := make([]*http.Request, maxRedirects)
		for i := range via {
			via[i] = newRequest(t, "https://example.com/step")
		}

		if err := redirectPolicy(newRequest(t, "https://example.com/next"), via); !errors.Is(err, errTooManyRedirects) {
			t.Fatalf("expected redirect limit error, got %v", err)
		}
	})

	t.Run("rejects non http scheme", func(t *testing.T) {
		via := []*http.Request{newRequest(t, "https://example.com/step")}

		if err := redirectPolicy(newRequest(t, "file:///etc/passwd"), via); !errors.Is(err, errBadRedirectURL) {
			t.Fatalf("expected scheme rejection, got %v", err)
		}
	})

	t.Run("rejects empty host", func(t *testing.T) {
		via := []*http.Request{newRequest(t, "https://example.com/step")}
		req := &http.Request{URL: &url.URL{Scheme: "http"}}

		if err := redirectPolicy(req, via); !errors.Is(err, errBadRedirectURL) {
			t.Fatalf("expected host rejection, got %v", err)
		}
	})

	t.Run("strips authorization across hosts and keeps it stripped on subsequent hops", func(t *testing.T) {
		initial := newRequest(t, "https://a.example/step")
		initial.Header.Set("Authorization", "Bearer secret")
		hop1 := newRequest(t, "https://b.example/hop1")
		hop1.Header.Set("Authorization", "Bearer secret")

		if err := redirectPolicy(hop1, []*http.Request{initial}); err != nil {
			t.Fatalf("unexpected error on hop 1: %v", err)
		}

		if hop1.Header.Get("Authorization") != "" {
			t.Fatal("expected authorization header to be stripped on hop 1")
		}

		hop2 := newRequest(t, "https://b.example/hop2")
		hop2.Header.Set("Authorization", "Bearer secret")

		if err := redirectPolicy(hop2, []*http.Request{initial, hop1}); err != nil {
			t.Fatalf("unexpected error on hop 2: %v", err)
		}

		if hop2.Header.Get("Authorization") != "" {
			t.Fatal("expected authorization header to stay stripped on hop 2")
		}
	})

	t.Run("keeps authorization on same host", func(t *testing.T) {
		via := []*http.Request{newRequest(t, "https://a.example/step")}
		req := newRequest(t, "https://a.example/next")
		req.Header.Set("Authorization", "Bearer secret")

		if err := redirectPolicy(req, via); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if req.Header.Get("Authorization") != "Bearer secret" {
			t.Fatal("expected authorization header to be kept")
		}
	})

	t.Run("strips authorization on https to http downgrade", func(t *testing.T) {
		via := []*http.Request{newRequest(t, "https://example.com/a")}
		req := newRequest(t, "http://example.com/b")
		req.Header.Set("Authorization", "Bearer secret")

		if err := redirectPolicy(req, via); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if req.Header.Get("Authorization") != "" {
			t.Fatal("expected authorization header to be stripped")
		}
	})

	t.Run("strips authorization on port change", func(t *testing.T) {
		via := []*http.Request{newRequest(t, "https://example.com:8443/a")}
		req := newRequest(t, "https://example.com/b")
		req.Header.Set("Authorization", "Bearer secret")

		if err := redirectPolicy(req, via); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if req.Header.Get("Authorization") != "" {
			t.Fatal("expected authorization header to be stripped")
		}
	})

	t.Run("keeps authorization on same scheme and port", func(t *testing.T) {
		via := []*http.Request{newRequest(t, "https://example.com/a")}
		req := newRequest(t, "https://example.com/b")
		req.Header.Set("Authorization", "Bearer secret")

		if err := redirectPolicy(req, via); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if req.Header.Get("Authorization") != "Bearer secret" {
			t.Fatal("expected authorization header to be kept")
		}
	})

	t.Run("keeps authorization across default port", func(t *testing.T) {
		via := []*http.Request{newRequest(t, "https://example.com/a")}
		req := newRequest(t, "https://example.com:443/b")
		req.Header.Set("Authorization", "Bearer secret")

		if err := redirectPolicy(req, via); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if req.Header.Get("Authorization") != "Bearer secret" {
			t.Fatal("expected authorization header to be kept")
		}
	})
}

func TestBrowserDiscoveryRedirectPolicy(t *testing.T) {
	cases := []struct {
		name    string
		initial string
		target  string
		allowed bool
	}{
		{name: "http default port and host case", initial: "http://EXAMPLE.com/start", target: "http://example.com:80/next", allowed: true},
		{name: "https default port", initial: "https://example.com:443/start", target: "https://example.com/next", allowed: true},
		{name: "different host", initial: "http://example.com/start", target: "http://other.example/next"},
		{name: "different port", initial: "http://example.com/start", target: "http://example.com:81/next"},
		{name: "different scheme", initial: "http://example.com/start", target: "https://example.com/next"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			initial, err := http.NewRequest(http.MethodGet, tc.initial+"?token=secret", nil)
			if err != nil {
				t.Fatal(err)
			}

			target, err := http.NewRequest(http.MethodGet, tc.target, nil)
			if err != nil {
				t.Fatal(err)
			}

			target.Header.Set("Referer", initial.URL.String())
			target.Header.Set("Authorization", "Bearer secret")
			err = browserDiscoveryRedirectPolicy(target, []*http.Request{initial})
			if tc.allowed {
				if err != nil || target.Header.Get("Referer") != "" || target.Header.Get("Authorization") != "Bearer secret" {
					t.Fatalf("allowed redirect: err=%v referer=%q authorization=%q", err, target.Header.Get("Referer"), target.Header.Get("Authorization"))
				}

				return
			}

			if !errors.Is(err, errBadRedirectURL) || strings.Contains(err.Error(), "token=secret") {
				t.Fatalf("expected sanitized redirect error, got %v", err)
			}
		})
	}

	req, err := http.NewRequest(http.MethodGet, "http://example.com/next", nil)
	if err != nil {
		t.Fatal(err)
	}

	via := make([]*http.Request, maxRedirects)
	for i := range via {
		via[i] = req
	}

	if err := browserDiscoveryRedirectPolicy(req, via); !errors.Is(err, errTooManyRedirects) {
		t.Fatalf("expected redirect limit error, got %v", err)
	}
}

func TestPrivateNetworkBlocked(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("<html><body>should not be reached</body></html>"))
	}))
	defer server.Close()

	client := New(Config{})
	ctx := context.Background()

	_, _, err := client.FetchFeed(ctx, mustNormalizedURL(t, server.URL+"/feed.xml"))
	requireDomainCode(t, err, domain.ErrFetchFeedError)

	_, _, err = client.FetchWebpage(ctx, mustNormalizedURL(t, server.URL+"/page"))
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)

	_, _, _, err = client.FetchImage(ctx, server.URL+"/image.png")
	if err == nil {
		t.Fatal("expected image fetch against loopback to fail")
	}

	if !strings.Contains(err.Error(), "blocked non-public address") {
		t.Fatalf("expected blocked address error, got %v", err)
	}
}

func TestDialChecksResolvedAddress(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("unexpected"))
	}))
	defer server.Close()

	_, port, err := net.SplitHostPort(server.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}

	client := New(Config{})
	_, _, err = client.FetchFeed(context.Background(), mustNormalizedURL(t, "http://localhost:"+port+"/feed"))
	if !errors.Is(err, errBlockedAddress) {
		t.Fatalf("expected resolved loopback to be blocked, got %v", err)
	}
}

func TestRedirectToBlockedAddress(t *testing.T) {
	var blockedHits atomic.Int32

	blockedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		blockedHits.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer blockedServer.Close()

	allowedServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, blockedServer.URL+"/secret", http.StatusFound)
	}))
	defer allowedServer.Close()

	allowedAddress := allowedServer.Listener.Addr().String()

	client := New(Config{})
	client.httpClient = newHTTPClientWithDialCheck(func(address string) error {
		if address == allowedAddress {
			return nil
		}

		return checkDialAddress(address)
	})

	_, _, err := client.FetchFeed(context.Background(), mustNormalizedURL(t, allowedServer.URL+"/feed.xml"))
	requireDomainCode(t, err, domain.ErrFetchFeedError)

	if blockedHits.Load() != 0 {
		t.Fatal("expected redirect target to be blocked before connecting")
	}

	if !strings.Contains(err.Error(), "blocked non-public address") {
		t.Fatalf("expected blocked address error, got %v", err)
	}
}
