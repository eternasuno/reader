package fetcher

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"reader/internal/domain"
)

type stubSettings struct {
	settings domain.Settings
	err      error
}

func (s stubSettings) Get(ctx context.Context) (domain.Settings, error) {
	return s.settings, s.err
}

func (s stubSettings) UpdateRetention(ctx context.Context, retention int) error {
	return nil
}

func (s stubSettings) UpdateProvider(ctx context.Context, provider domain.ExtractorProvider) error {
	return nil
}

func (s stubSettings) UpdateJinaKey(ctx context.Context, key string) error {
	return nil
}

func (s stubSettings) DeleteJinaKey(ctx context.Context) error {
	return nil
}

func (s stubSettings) UpdateBrowserEndpoint(ctx context.Context, endpoint string) error {
	return nil
}

func (s stubSettings) DeleteBrowserEndpoint(ctx context.Context) error {
	return nil
}

func (s stubSettings) UpdateSMTP(ctx context.Context, smtp domain.SMTPSettings) error {
	return nil
}

func (s stubSettings) DeleteSMTPPassword(ctx context.Context) error {
	return nil
}

func (s stubSettings) DeleteSMTP(ctx context.Context) error {
	return nil
}

func (s stubSettings) UpdateKindle(ctx context.Context, kindle domain.KindleSettings) error {
	return nil
}

func (s stubSettings) AdvanceNextSendAt(ctx context.Context, nextSendAt time.Time) error {
	return nil
}

func ptr(value string) *string {
	return &value
}

func mustNormalizedURL(t *testing.T, raw string) domain.NormalizedURL {
	t.Helper()

	parsed, err := domain.ParseNormalizedURL(raw, domain.ErrFeedUrlInvalid)
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}

	return parsed
}

func requireDomainCode(t *testing.T, err error, code domain.ErrorCode) *domain.DomainError {
	t.Helper()

	if err == nil {
		t.Fatalf("expected %s error, got nil", code)
	}

	var domainErr *domain.DomainError
	if !errors.As(err, &domainErr) {
		t.Fatalf("expected domain error %s, got %T: %v", code, err, err)
	}

	if domainErr.Code != code {
		t.Fatalf("expected code %s, got %s: %v", code, domainErr.Code, err)
	}

	return domainErr
}

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
		"fc00::1",
		"ff02::1",
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

func TestFetchFeedSuccess(t *testing.T) {
	var gotUserAgent string
	var gotAccept string
	var gotAuthorization string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUserAgent = r.Header.Get("User-Agent")
		gotAccept = r.Header.Get("Accept")
		gotAuthorization = r.Header.Get("Authorization")

		w.Header().Set("Content-Type", "application/rss+xml")
		w.Write([]byte("<rss><channel/></rss>"))
	}))
	defer server.Close()

	client := New(Config{AllowPrivateNetwork: true})
	body, finalURL, err := client.FetchFeed(context.Background(), mustNormalizedURL(t, server.URL+"/feed.xml"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if string(body) != "<rss><channel/></rss>" {
		t.Fatalf("unexpected body %q", body)
	}

	if finalURL != server.URL+"/feed.xml" {
		t.Fatalf("unexpected final url %q", finalURL)
	}

	if gotUserAgent != defaultUserAgent {
		t.Fatalf("unexpected user agent %q", gotUserAgent)
	}

	if !strings.Contains(gotAccept, "application/rss+xml") {
		t.Fatalf("unexpected accept header %q", gotAccept)
	}

	if gotAuthorization != "" {
		t.Fatal("expected no authorization header")
	}
}

func TestFetchFeedBasicAuth(t *testing.T) {
	var gotAuthorization string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuthorization = r.Header.Get("Authorization")
		w.Write([]byte("<rss/>"))
	}))
	defer server.Close()

	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parse server url: %v", err)
	}

	credentialed := fmt.Sprintf("http://feeduser:feedsecret@%s/private.xml", parsed.Host)
	client := New(Config{AllowPrivateNetwork: true})

	body, finalURL, err := client.FetchFeed(context.Background(), mustNormalizedURL(t, credentialed))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if string(body) != "<rss/>" {
		t.Fatalf("unexpected body %q", body)
	}

	expected := "Basic " + base64.StdEncoding.EncodeToString([]byte("feeduser:feedsecret"))
	if gotAuthorization != expected {
		t.Fatalf("unexpected authorization header %q", gotAuthorization)
	}

	if strings.Contains(finalURL, "feedsecret") || strings.Contains(finalURL, "@") {
		t.Fatalf("final url leaks credentials: %q", finalURL)
	}
}

func TestFetchFeedRedactsRedirectCredentials(t *testing.T) {
	var server *httptest.Server

	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/feed.xml" {
			parsed, err := url.Parse(server.URL)
			if err != nil {
				t.Errorf("parse server url: %v", err)
				return
			}

			target := fmt.Sprintf("http://rediruser:redirsecret@%s/next.xml", parsed.Host)
			http.Redirect(w, r, target, http.StatusFound)

			return
		}

		w.Write([]byte("<rss/>"))
	}))
	defer server.Close()

	client := New(Config{AllowPrivateNetwork: true})
	_, finalURL, err := client.FetchFeed(context.Background(), mustNormalizedURL(t, server.URL+"/feed.xml"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if strings.Contains(finalURL, "redirsecret") || strings.Contains(finalURL, "@") {
		t.Fatalf("final url leaks credentials: %q", finalURL)
	}
}

func TestFetchFeedErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/missing.xml":
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte("boom"))
		case "/large.xml":
			w.Write([]byte(strings.Repeat("a", 64)))
		case "/slow.xml":
			time.Sleep(200 * time.Millisecond)
			w.Write([]byte("<rss/>"))
		default:
			w.Write([]byte("<rss/>"))
		}
	}))
	defer server.Close()

	t.Run("non 2xx", func(t *testing.T) {
		client := New(Config{AllowPrivateNetwork: true})
		_, _, err := client.FetchFeed(context.Background(), mustNormalizedURL(t, server.URL+"/missing.xml"))
		requireDomainCode(t, err, domain.ErrFetchFeedError)
	})

	t.Run("body too large", func(t *testing.T) {
		client := New(Config{AllowPrivateNetwork: true, MaxBodyBytes: 8})
		_, _, err := client.FetchFeed(context.Background(), mustNormalizedURL(t, server.URL+"/large.xml"))
		requireDomainCode(t, err, domain.ErrFetchFeedError)

		if !strings.Contains(err.Error(), "response body too large") {
			t.Fatalf("expected body too large error, got %v", err)
		}
	})

	t.Run("timeout", func(t *testing.T) {
		client := New(Config{AllowPrivateNetwork: true, FeedTimeout: 20 * time.Millisecond})
		_, _, err := client.FetchFeed(context.Background(), mustNormalizedURL(t, server.URL+"/slow.xml"))
		requireDomainCode(t, err, domain.ErrFetchFeedError)
	})

	t.Run("empty url", func(t *testing.T) {
		client := New(Config{AllowPrivateNetwork: true})
		_, _, err := client.FetchFeed(context.Background(), domain.NormalizedURL{})
		requireDomainCode(t, err, domain.ErrFetchFeedError)
	})

	t.Run("credentialed failure redacts credentials", func(t *testing.T) {
		parsed, err := url.Parse(server.URL)
		if err != nil {
			t.Fatalf("parse server url: %v", err)
		}

		credentialed := fmt.Sprintf("http://failuser:failsecret@%s/missing.xml", parsed.Host)
		client := New(Config{AllowPrivateNetwork: true})

		_, _, fetchErr := client.FetchFeed(context.Background(), mustNormalizedURL(t, credentialed))
		requireDomainCode(t, fetchErr, domain.ErrFetchFeedError)

		if strings.Contains(fetchErr.Error(), "failsecret") {
			t.Fatalf("error leaks credentials: %v", fetchErr)
		}
	})
}

func TestFetchWebpageDirect(t *testing.T) {
	var gotAuthorization string
	var gotUserAgent string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuthorization = r.Header.Get("Authorization")
		gotUserAgent = r.Header.Get("User-Agent")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte("<html><body><p>direct</p></body></html>"))
	}))
	defer server.Close()

	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parse server url: %v", err)
	}

	credentialed := fmt.Sprintf("http://pageuser:pagesecret@%s/page", parsed.Host)
	client := New(Config{AllowPrivateNetwork: true})

	body, finalURL, err := client.FetchWebpage(context.Background(), mustNormalizedURL(t, credentialed))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(body, "<p>direct</p>") {
		t.Fatalf("unexpected body %q", body)
	}

	expected := "Basic " + base64.StdEncoding.EncodeToString([]byte("pageuser:pagesecret"))
	if gotAuthorization != expected {
		t.Fatalf("unexpected authorization header %q", gotAuthorization)
	}

	if gotUserAgent != defaultUserAgent {
		t.Fatalf("unexpected user agent %q", gotUserAgent)
	}

	if strings.Contains(finalURL, "pagesecret") {
		t.Fatalf("final url leaks credentials: %q", finalURL)
	}
}

func TestFetchWebpageSettingsError(t *testing.T) {
	client := New(Config{AllowPrivateNetwork: true, Settings: stubSettings{err: errors.New("settings unavailable")}})
	_, _, err := client.FetchWebpage(context.Background(), mustNormalizedURL(t, "http://example.com/page"))
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)
}

func TestFetchWebpageJina(t *testing.T) {
	var requests atomic.Int32
	var gotAuthorization string
	var gotRespondWith string
	var gotAccept string
	var gotPath string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		gotAuthorization = r.Header.Get("Authorization")
		gotRespondWith = r.Header.Get("X-Respond-With")
		gotAccept = r.Header.Get("Accept")
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("<html><body><p>jina</p></body></html>"))
	}))
	defer server.Close()

	key := "  jina-secret-key  "
	client := New(Config{
		AllowPrivateNetwork: true,
		Settings: stubSettings{
			settings: domain.Settings{Provider: domain.ProviderJina, JinaKey: &key},
		},
		JinaBaseURL: server.URL,
	})

	body, finalURL, err := client.FetchWebpage(context.Background(), mustNormalizedURL(t, "http://example.com/article"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !strings.Contains(body, "<p>jina</p>") {
		t.Fatalf("unexpected body %q", body)
	}

	if finalURL != "http://example.com/article" {
		t.Fatalf("unexpected final url %q", finalURL)
	}

	if gotPath != "/http://example.com/article" {
		t.Fatalf("unexpected jina path %q", gotPath)
	}

	if gotRespondWith != "html" {
		t.Fatalf("unexpected X-Respond-With %q", gotRespondWith)
	}

	if gotAccept != jinaAccept {
		t.Fatalf("unexpected accept header %q", gotAccept)
	}

	if gotAuthorization != "Bearer jina-secret-key" {
		t.Fatalf("unexpected authorization header %q", gotAuthorization)
	}

	if requests.Load() != 1 {
		t.Fatalf("expected 1 jina request, got %d", requests.Load())
	}
}

func TestFetchWebpageJinaWithoutKey(t *testing.T) {
	var gotAuthorization atomic.Value
	gotAuthorization.Store("unset")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if values, ok := r.Header["Authorization"]; ok {
			gotAuthorization.Store(strings.Join(values, ","))
		} else {
			gotAuthorization.Store("")
		}

		w.Write([]byte("<html><body>jina</body></html>"))
	}))
	defer server.Close()

	client := New(Config{
		AllowPrivateNetwork: true,
		Settings:            stubSettings{settings: domain.Settings{Provider: domain.ProviderJina}},
		JinaBaseURL:         server.URL + "/",
	})

	if _, _, err := client.FetchWebpage(context.Background(), mustNormalizedURL(t, "https://example.com/article")); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if gotAuthorization.Load() != "" {
		t.Fatalf("expected no authorization header, got %v", gotAuthorization.Load())
	}
}

func TestFetchWebpageJinaRefusesCredentials(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		w.Write([]byte("<html><body>jina</body></html>"))
	}))
	defer server.Close()

	client := New(Config{
		AllowPrivateNetwork: true,
		Settings:            stubSettings{settings: domain.Settings{Provider: domain.ProviderJina}},
		JinaBaseURL:         server.URL,
	})

	_, _, err := client.FetchWebpage(context.Background(), mustNormalizedURL(t, "http://user:secret@example.com/article"))
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)

	if requests.Load() != 0 {
		t.Fatalf("expected no outbound requests, got %d", requests.Load())
	}
}

func TestFetchWebpageBrowser(t *testing.T) {
	var gotEndpoint string
	var gotTarget string
	var gotTimeout time.Duration
	called := false

	client := New(Config{
		AllowPrivateNetwork: true,
		Settings: stubSettings{
			settings: domain.Settings{
				Provider:        domain.ProviderBrowser,
				BrowserEndpoint: ptr("ws://browser.internal:9222"),
			},
		},
		BrowserFetch: func(ctx context.Context, endpoint string, targetURL string, timeout time.Duration) (string, string, error) {
			called = true
			gotEndpoint = endpoint
			gotTarget = targetURL
			gotTimeout = timeout

			return "<html><body><p>browser</p></body></html>", targetURL, nil
		},
	})

	body, finalURL, err := client.FetchWebpage(context.Background(), mustNormalizedURL(t, "http://example.com/page"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !called {
		t.Fatal("expected browser fetch to be called")
	}

	if gotEndpoint != "ws://browser.internal:9222" {
		t.Fatalf("unexpected endpoint %q", gotEndpoint)
	}

	if gotTarget != "http://example.com/page" {
		t.Fatalf("unexpected target %q", gotTarget)
	}

	if gotTimeout != defaultWebpageTimeout {
		t.Fatalf("unexpected timeout %s", gotTimeout)
	}

	if !strings.Contains(body, "<p>browser</p>") {
		t.Fatalf("unexpected body %q", body)
	}

	if finalURL != "http://example.com/page" {
		t.Fatalf("unexpected final url %q", finalURL)
	}
}

func TestFetchWebpageBrowserRefusesCredentials(t *testing.T) {
	called := false
	client := New(Config{
		AllowPrivateNetwork: true,
		Settings: stubSettings{
			settings: domain.Settings{
				Provider:        domain.ProviderBrowser,
				BrowserEndpoint: ptr("ws://browser.internal:9222"),
			},
		},
		BrowserFetch: func(ctx context.Context, endpoint string, targetURL string, timeout time.Duration) (string, string, error) {
			called = true

			return "<html/>", targetURL, nil
		},
	})

	_, _, err := client.FetchWebpage(context.Background(), mustNormalizedURL(t, "http://user:secret@example.com/page"))
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)

	if called {
		t.Fatal("expected browser fetch to be skipped")
	}
}

func TestFetchWebpageBrowserErrors(t *testing.T) {
	t.Run("missing endpoint", func(t *testing.T) {
		client := New(Config{
			AllowPrivateNetwork: true,
			Settings:            stubSettings{settings: domain.Settings{Provider: domain.ProviderBrowser}},
		})

		_, _, err := client.FetchWebpage(context.Background(), mustNormalizedURL(t, "http://example.com/page"))
		requireDomainCode(t, err, domain.ErrWebpageFetcherError)

		if !strings.Contains(err.Error(), "browser endpoint is not configured") {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("invalid endpoint", func(t *testing.T) {
		client := New(Config{
			AllowPrivateNetwork: true,
			Settings: stubSettings{
				settings: domain.Settings{
					Provider:        domain.ProviderBrowser,
					BrowserEndpoint: ptr("ftp://browser.internal:21"),
				},
			},
		})

		_, _, err := client.FetchWebpage(context.Background(), mustNormalizedURL(t, "http://example.com/page"))
		requireDomainCode(t, err, domain.ErrWebpageFetcherError)
	})

	t.Run("sanitizes endpoint from failure", func(t *testing.T) {
		endpoint := "ws://token:browser-secret@browser.internal:9222/devtools/browser/abc"
		client := New(Config{
			AllowPrivateNetwork: true,
			Settings: stubSettings{
				settings: domain.Settings{
					Provider:        domain.ProviderBrowser,
					BrowserEndpoint: ptr(endpoint),
				},
			},
			BrowserFetch: func(ctx context.Context, gotEndpoint string, targetURL string, timeout time.Duration) (string, string, error) {
				return "", "", fmt.Errorf("could not dial %q: connection refused", endpoint)
			},
		})

		_, _, err := client.FetchWebpage(context.Background(), mustNormalizedURL(t, "http://example.com/page"))
		requireDomainCode(t, err, domain.ErrWebpageFetcherError)

		if strings.Contains(err.Error(), endpoint) || strings.Contains(err.Error(), "browser-secret") {
			t.Fatalf("error leaks browser endpoint: %v", err)
		}
	})

	t.Run("redacts credentialed endpoint secrets", func(t *testing.T) {
		endpoint := "http://admin:secret@10.0.0.5:9222/devtools/browser/secret-path-token?api_key=secret-query-token"
		client := New(Config{
			AllowPrivateNetwork: true,
			Settings: stubSettings{
				settings: domain.Settings{
					Provider:        domain.ProviderBrowser,
					BrowserEndpoint: ptr(endpoint),
				},
			},
			BrowserFetch: func(ctx context.Context, gotEndpoint string, targetURL string, timeout time.Duration) (string, string, error) {
				return "", "", fmt.Errorf("could not connect to %s: dial tcp: connection refused", gotEndpoint)
			},
		})

		_, _, err := client.FetchWebpage(context.Background(), mustNormalizedURL(t, "http://example.com/page"))
		requireDomainCode(t, err, domain.ErrWebpageFetcherError)

		for _, secret := range []string{"admin", "secret", "10.0.0.5", "9222", "secret-path-token", "secret-query-token", "api_key"} {
			if strings.Contains(err.Error(), secret) {
				t.Fatalf("error leaks %q: %v", secret, err)
			}
		}
	})

	t.Run("body too large", func(t *testing.T) {
		client := New(Config{
			AllowPrivateNetwork: true,
			MaxBodyBytes:        8,
			Settings: stubSettings{
				settings: domain.Settings{
					Provider:        domain.ProviderBrowser,
					BrowserEndpoint: ptr("ws://browser.internal:9222"),
				},
			},
			BrowserFetch: func(ctx context.Context, endpoint string, targetURL string, timeout time.Duration) (string, string, error) {
				return strings.Repeat("x", 64), targetURL, nil
			},
		})

		_, _, err := client.FetchWebpage(context.Background(), mustNormalizedURL(t, "http://example.com/page"))
		requireDomainCode(t, err, domain.ErrWebpageFetcherError)

		if !strings.Contains(err.Error(), "response body too large") {
			t.Fatalf("unexpected error: %v", err)
		}
	})
}

func TestFetchImageFormats(t *testing.T) {
	cases := []struct {
		name      string
		data      []byte
		mediaType string
		ext       string
	}{
		{"png", []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"), "image/png", ".png"},
		{"jpeg", []byte("\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01"), "image/jpeg", ".jpg"},
		{"gif", []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;"), "image/gif", ".gif"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/octet-stream")
				w.Write(tc.data)
			}))
			defer server.Close()

			client := New(Config{AllowPrivateNetwork: true})
			data, mediaType, ext, err := client.FetchImage(context.Background(), server.URL+"/image")
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if string(data) != string(tc.data) {
				t.Fatalf("unexpected image bytes")
			}

			if mediaType != tc.mediaType || ext != tc.ext {
				t.Fatalf("unexpected format %q %q", mediaType, ext)
			}
		})
	}
}

func TestFetchImageRejectsUnsupported(t *testing.T) {
	cases := []struct {
		name string
		data []byte
	}{
		{"svg", []byte(`<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>`)},
		{"webp", []byte("RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00")},
		{"avif", []byte("\x00\x00\x00\x1cftypavif\x00\x00\x00\x00avifmif1")},
		{"html", []byte("<html><body>nope</body></html>")},
		{"bmp", []byte("BM\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00")},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "image/png")
				w.Write(tc.data)
			}))
			defer server.Close()

			client := New(Config{AllowPrivateNetwork: true})
			_, _, _, err := client.FetchImage(context.Background(), server.URL+"/image")
			if err == nil {
				t.Fatal("expected unsupported image to fail")
			}

			if !errors.Is(err, errUnsupportedImage) {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestFetchImageErrors(t *testing.T) {
	pngData := []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/missing":
			w.WriteHeader(http.StatusNotFound)
		case "/large":
			w.Write(pngData)
			w.Write(pngData)
			w.Write(pngData)
		case "/empty":
			w.WriteHeader(http.StatusOK)
		default:
			w.Write(pngData)
		}
	}))
	defer server.Close()

	t.Run("non 2xx", func(t *testing.T) {
		client := New(Config{AllowPrivateNetwork: true})
		_, _, _, err := client.FetchImage(context.Background(), server.URL+"/missing")
		if err == nil {
			t.Fatal("expected non 2xx image fetch to fail")
		}
	})

	t.Run("oversize", func(t *testing.T) {
		client := New(Config{AllowPrivateNetwork: true, MaxBodyBytes: 8})
		_, _, _, err := client.FetchImage(context.Background(), server.URL+"/large")
		if !errors.Is(err, errResponseTooLarge) {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("empty body", func(t *testing.T) {
		client := New(Config{AllowPrivateNetwork: true})
		_, _, _, err := client.FetchImage(context.Background(), server.URL+"/empty")
		if !errors.Is(err, errEmptyResponseBody) {
			t.Fatalf("unexpected error: %v", err)
		}
	})

	t.Run("invalid url", func(t *testing.T) {
		client := New(Config{AllowPrivateNetwork: true})
		_, _, _, err := client.FetchImage(context.Background(), "not a url")
		requireDomainCode(t, err, domain.ErrInvalidPageUrl)
	})

	t.Run("unsupported scheme", func(t *testing.T) {
		client := New(Config{AllowPrivateNetwork: true})
		_, _, _, err := client.FetchImage(context.Background(), "ftp://example.com/image.png")
		requireDomainCode(t, err, domain.ErrInvalidPageUrl)
	})
}

func TestFetchImageBasicAuth(t *testing.T) {
	var gotAuthorization string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuthorization = r.Header.Get("Authorization")
		w.Write([]byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"))
	}))
	defer server.Close()

	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parse server url: %v", err)
	}

	credentialed := fmt.Sprintf("http://imguser:imgsecret@%s/image.png", parsed.Host)
	client := New(Config{AllowPrivateNetwork: true})

	if _, _, _, err := client.FetchImage(context.Background(), credentialed); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	expected := "Basic " + base64.StdEncoding.EncodeToString([]byte("imguser:imgsecret"))
	if gotAuthorization != expected {
		t.Fatalf("unexpected authorization header %q", gotAuthorization)
	}
}

func TestDetectImageType(t *testing.T) {
	if _, _, ok := detectImageType([]byte("\x89PNG\r\n\x1a\n")); !ok {
		t.Fatal("expected png signature to be recognised")
	}

	if mediaType, ext, ok := detectImageType([]byte("\xff\xd8\xff\xe0")); !ok || mediaType != "image/jpeg" || ext != ".jpg" {
		t.Fatalf("unexpected jpeg detection: %q %q %v", mediaType, ext, ok)
	}

	if _, _, ok := detectImageType([]byte("GIF87a")); !ok {
		t.Fatal("expected gif signature to be recognised")
	}

	if _, _, ok := detectImageType([]byte("<html>")); ok {
		t.Fatal("expected html to be rejected")
	}
}
