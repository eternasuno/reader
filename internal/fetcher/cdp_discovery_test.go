package fetcher

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type roundTripFunc func(req *http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func noDNSLookup(ctx context.Context, host string) ([]net.IPAddr, error) {
	return nil, fmt.Errorf("unexpected DNS lookup for %q", host)
}

func TestBrowserDiscoveryURL(t *testing.T) {
	cases := []struct {
		name     string
		endpoint string
		want     string
	}{
		{
			name:     "http with port",
			endpoint: "http://browser.internal:9222",
			want:     "http://browser.internal:9222/json/version",
		},
		{
			name:     "https without port",
			endpoint: "https://browser.example.com",
			want:     "https://browser.example.com/json/version",
		},
		{
			name:     "http without port",
			endpoint: "http://browser.example.com/custom",
			want:     "http://browser.example.com/json/version",
		},
		{
			name:     "ws preserves cleartext and query",
			endpoint: "ws://browser.internal:9222/devtools?token=abc",
			want:     "http://browser.internal:9222/json/version?token=abc",
		},
		{
			name:     "wss preserves TLS and never downgrades to http",
			endpoint: "WSS://browser.example.com?token=abc#frag",
			want:     "https://browser.example.com/json/version?token=abc",
		},
		{
			name:     "https ipv6 without port",
			endpoint: "https://[::1]",
			want:     "https://[::1]/json/version",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			parsed, err := url.Parse(tc.endpoint)
			if err != nil {
				t.Fatalf("url.Parse(%q): %v", tc.endpoint, err)
			}

			got := browserDiscoveryURL(parsed).String()
			if got != tc.want {
				t.Fatalf("browserDiscoveryURL(%q) = %q, want %q", tc.endpoint, got, tc.want)
			}
		})
	}
}
func TestBrowserDiscoveryRedirects(t *testing.T) {
	const query = "token=discovery-secret"

	t.Run("cross origin rejected", func(t *testing.T) {
		var received atomic.Int32
		target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			received.Add(1)
		}))
		defer target.Close()

		source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, target.URL+"/next", http.StatusFound)
		}))
		defer source.Close()

		_, err := resolveBrowserWSURL(context.Background(), newBrowserDiscoveryClient(), noDNSLookup, source.URL+"?"+query, 2*time.Second)
		if !errors.Is(err, errBrowserFetchFailed) {
			t.Fatalf("expected discovery failure, got %v", err)
		}

		if strings.Contains(err.Error(), query) {
			t.Fatal("error contains endpoint query")
		}

		if received.Load() != 0 {
			t.Fatal("cross-origin server received a request")
		}
	})

	t.Run("same origin succeeds without referer", func(t *testing.T) {
		var received atomic.Bool
		var referer atomic.Value
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/json/version" {
				http.Redirect(w, r, "/next", http.StatusFound)

				return
			}

			received.Store(true)
			referer.Store(r.Header.Get("Referer"))
			_, _ = w.Write([]byte(`{"webSocketDebuggerUrl":"ws://127.0.0.1/devtools/browser/1"}`))
		}))
		defer server.Close()

		got, err := resolveBrowserWSURL(context.Background(), newBrowserDiscoveryClient(), noDNSLookup, server.URL+"?"+query, 2*time.Second)
		if err != nil {
			t.Fatalf("discovery failed: %v", err)
		}

		if got != "ws://127.0.0.1/devtools/browser/1" || !received.Load() {
			t.Fatalf("unexpected discovery result %q, redirected request received: %t", got, received.Load())
		}

		if referer.Load() != "" {
			t.Fatal("redirected request included Referer")
		}
	})
}

func TestResolveBrowserWSURL(t *testing.T) {
	t.Run("https endpoint is discovered over TLS", func(t *testing.T) {
		var sawTLS atomic.Bool
		var sawPath atomic.Value

		server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sawTLS.Store(r.TLS != nil)
			sawPath.Store(r.URL.Path)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"webSocketDebuggerUrl":"wss://browser.example.com/devtools/browser/tls-1"}`))
		}))
		defer server.Close()

		got, err := resolveBrowserWSURL(context.Background(), server.Client(), noDNSLookup, server.URL, 2*time.Second)
		if err != nil {
			t.Fatalf("resolveBrowserWSURL failed: %v", err)
		}

		if !sawTLS.Load() {
			t.Fatal("expected discovery request to arrive over TLS")
		}

		if sawPath.Load() != "/json/version" {
			t.Fatalf("unexpected discovery path %v", sawPath.Load())
		}

		if got != "wss://browser.example.com/devtools/browser/tls-1" {
			t.Fatalf("unexpected wsURL %q", got)
		}
	})

	t.Run("https hostname endpoint is not resolved or rewritten", func(t *testing.T) {
		var gotScheme, gotHost, gotPath string
		httpClient := &http.Client{
			Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				gotScheme = req.URL.Scheme
				gotHost = req.URL.Host
				gotPath = req.URL.Path

				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": {"application/json"}},
					Body:       io.NopCloser(strings.NewReader(`{"webSocketDebuggerUrl":"wss://browser.example.com/devtools/browser/noport"}`)),
				}, nil
			}),
		}

		got, err := resolveBrowserWSURL(context.Background(), httpClient, noDNSLookup, "https://browser.example.com", 2*time.Second)
		if err != nil {
			t.Fatalf("resolveBrowserWSURL failed: %v", err)
		}

		if gotScheme != "https" || gotHost != "browser.example.com" || gotPath != "/json/version" {
			t.Fatalf("unexpected discovery request %s://%s%s", gotScheme, gotHost, gotPath)
		}

		if got != "wss://browser.example.com/devtools/browser/noport" {
			t.Fatalf("unexpected wsURL %q", got)
		}
	})

	t.Run("http hostname resolves to preferred IPv4 and rewrites ws URL", func(t *testing.T) {
		var gotScheme, gotURLHost, gotReqHost, gotPath, gotAuth string
		var lookedUp []string

		lookup := func(ctx context.Context, host string) ([]net.IPAddr, error) {
			lookedUp = append(lookedUp, host)

			return []net.IPAddr{
				{IP: net.ParseIP("2001:db8::1")},
				{IP: net.ParseIP("172.18.0.5")},
			}, nil
		}

		httpClient := &http.Client{
			Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				gotScheme = req.URL.Scheme
				gotURLHost = req.URL.Host
				gotReqHost = req.Host
				gotPath = req.URL.Path
				gotAuth = req.Header.Get("Authorization")

				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": {"application/json"}},
					Body:       io.NopCloser(strings.NewReader(`{"webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/browser/docker-1?k=v"}`)),
				}, nil
			}),
		}

		got, err := resolveBrowserWSURL(
			context.Background(),
			httpClient,
			lookup,
			"http://cdpuser:cdpsecret@browser.internal:9222",
			2*time.Second,
		)
		if err != nil {
			t.Fatalf("resolveBrowserWSURL failed: %v", err)
		}

		if len(lookedUp) != 1 || lookedUp[0] != "browser.internal" {
			t.Fatalf("unexpected lookup hosts %v", lookedUp)
		}

		if gotScheme != "http" || gotURLHost != "172.18.0.5:9222" || gotReqHost != "172.18.0.5:9222" || gotPath != "/json/version" {
			t.Fatalf("unexpected discovery request scheme=%q urlHost=%q reqHost=%q path=%q", gotScheme, gotURLHost, gotReqHost, gotPath)
		}

		expectedAuth := "Basic " + base64.StdEncoding.EncodeToString([]byte("cdpuser:cdpsecret"))
		if gotAuth != expectedAuth {
			t.Fatalf("unexpected authorization header %q", gotAuth)
		}

		if got != "ws://172.18.0.5:9222/devtools/browser/docker-1?k=v" {
			t.Fatalf("unexpected wsURL %q", got)
		}
	})

	t.Run("http hostname without port falls back to IPv6", func(t *testing.T) {
		var gotURLHost string
		lookup := func(ctx context.Context, host string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("2001:db8::9")}}, nil
		}

		httpClient := &http.Client{
			Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				gotURLHost = req.URL.Host

				return &http.Response{
					StatusCode: http.StatusOK,
					Header:     http.Header{"Content-Type": {"application/json"}},
					Body:       io.NopCloser(strings.NewReader(`{"webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/browser/v6"}`)),
				}, nil
			}),
		}

		got, err := resolveBrowserWSURL(context.Background(), httpClient, lookup, "http://browser.ipv6", 2*time.Second)
		if err != nil {
			t.Fatalf("resolveBrowserWSURL failed: %v", err)
		}

		if gotURLHost != "[2001:db8::9]" {
			t.Fatalf("unexpected request host %q", gotURLHost)
		}

		if got != "ws://[2001:db8::9]/devtools/browser/v6" {
			t.Fatalf("unexpected wsURL %q", got)
		}
	})

	t.Run("http IP-literal and localhost endpoints are not resolved", func(t *testing.T) {
		cases := []struct {
			endpoint string
			wantHost string
		}{
			{endpoint: "http://127.0.0.1:9222", wantHost: "127.0.0.1:9222"},
			{endpoint: "http://[::1]:9222", wantHost: "[::1]:9222"},
			{endpoint: "http://localhost:9222", wantHost: "localhost:9222"},
			{endpoint: "http://LOCALHOST:9222", wantHost: "LOCALHOST:9222"},
		}

		for _, tc := range cases {
			var gotHost string
			httpClient := &http.Client{
				Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					gotHost = req.URL.Host

					return &http.Response{
						StatusCode: http.StatusOK,
						Header:     http.Header{"Content-Type": {"application/json"}},
						Body:       io.NopCloser(strings.NewReader(`{"webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/browser/local"}`)),
					}, nil
				}),
			}

			got, err := resolveBrowserWSURL(context.Background(), httpClient, noDNSLookup, tc.endpoint, 2*time.Second)
			if err != nil {
				t.Fatalf("resolveBrowserWSURL(%q): %v", tc.endpoint, err)
			}

			if gotHost != tc.wantHost {
				t.Fatalf("resolveBrowserWSURL(%q) requested host %q, want %q", tc.endpoint, gotHost, tc.wantHost)
			}

			if got != "ws://127.0.0.1:9222/devtools/browser/local" {
				t.Fatalf("resolveBrowserWSURL(%q) = %q", tc.endpoint, got)
			}
		}
	})

	t.Run("ws and wss endpoints skip discovery and resolve only plaintext hostnames", func(t *testing.T) {
		var requests atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requests.Add(1)
			http.Error(w, "should not be called", http.StatusInternalServerError)
		}))
		defer server.Close()

		lookup := func(ctx context.Context, host string) ([]net.IPAddr, error) {
			if host != "browser.internal" {
				t.Fatalf("unexpected DNS lookup for %q", host)
			}

			return []net.IPAddr{{IP: net.ParseIP("172.18.0.5")}}, nil
		}

		cases := []struct {
			endpoint string
			want     string
		}{
			{
				endpoint: "ws://browser.internal:9222/devtools/browser/1",
				want:     "ws://172.18.0.5:9222/devtools/browser/1",
			},
			{
				endpoint: "ws://127.0.0.1:9222/devtools/browser/1",
				want:     "ws://127.0.0.1:9222/devtools/browser/1",
			},
			{
				endpoint: "ws://localhost:9222/devtools/browser/1",
				want:     "ws://localhost:9222/devtools/browser/1",
			},
			{
				endpoint: "WSS://browser.example.com/devtools?token=abc",
				want:     "wss://browser.example.com/devtools?token=abc",
			},
		}

		for _, tc := range cases {
			got, err := resolveBrowserWSURL(context.Background(), server.Client(), lookup, tc.endpoint, 2*time.Second)
			if err != nil {
				t.Fatalf("resolveBrowserWSURL(%q): %v", tc.endpoint, err)
			}

			if got != tc.want {
				t.Fatalf("resolveBrowserWSURL(%q) = %q, want %q", tc.endpoint, got, tc.want)
			}
		}

		if requests.Load() != 0 {
			t.Fatalf("expected 0 discovery requests for ws/wss endpoints, got %d", requests.Load())
		}
	})

	t.Run("resolution failure returns classified error without leaking hostname", func(t *testing.T) {
		var requests atomic.Int32
		httpClient := &http.Client{
			Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				requests.Add(1)

				return nil, errors.New("unexpected http call")
			}),
		}

		failLookup := func(ctx context.Context, host string) ([]net.IPAddr, error) {
			return nil, fmt.Errorf("lookup %s: no such host", host)
		}

		for _, endpoint := range []string{
			"http://secret-browser.internal:9222",
			"ws://secret-browser.internal:9222/devtools/browser/1",
		} {
			_, err := resolveBrowserWSURL(context.Background(), httpClient, failLookup, endpoint, 2*time.Second)
			if !errors.Is(err, errBrowserFetchFailed) {
				t.Fatalf("endpoint %q: expected errBrowserFetchFailed, got %v", endpoint, err)
			}

			if strings.Contains(err.Error(), "secret-browser.internal") {
				t.Fatalf("endpoint %q: error leaks hostname: %v", endpoint, err)
			}
		}

		emptyLookup := func(ctx context.Context, host string) ([]net.IPAddr, error) {
			return nil, nil
		}

		if _, err := resolveBrowserWSURL(context.Background(), httpClient, emptyLookup, "http://secret-browser.internal:9222", 2*time.Second); !errors.Is(err, errBrowserFetchFailed) {
			t.Fatalf("empty lookup: expected errBrowserFetchFailed, got %v", err)
		}

		timeoutLookup := func(ctx context.Context, host string) ([]net.IPAddr, error) {
			return nil, fmt.Errorf("lookup %s: %w", host, context.DeadlineExceeded)
		}

		_, err := resolveBrowserWSURL(context.Background(), httpClient, timeoutLookup, "http://secret-browser.internal:9222", 2*time.Second)
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("timeout lookup: expected DeadlineExceeded, got %v", err)
		}

		if strings.Contains(err.Error(), "secret-browser.internal") {
			t.Fatalf("timeout error leaks hostname: %v", err)
		}

		if requests.Load() != 0 {
			t.Fatalf("expected 0 discovery requests on resolution failure, got %d", requests.Load())
		}
	})

	t.Run("rejects invalid webSocketDebuggerUrl payloads", func(t *testing.T) {
		payloads := []string{
			`{}`,
			`{"webSocketDebuggerUrl":null}`,
			`{"webSocketDebuggerUrl":123}`,
			`{"webSocketDebuggerUrl":{"url":"ws://127.0.0.1:9222/devtools/browser/1"}}`,
			`{"webSocketDebuggerUrl":""}`,
			`{"webSocketDebuggerUrl":"http://127.0.0.1:9222/devtools/browser/1"}`,
			`{"webSocketDebuggerUrl":"ws:///devtools/browser/1"}`,
			`not-json`,
		}

		for _, body := range payloads {
			httpClient := &http.Client{
				Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
					return &http.Response{
						StatusCode: http.StatusOK,
						Body:       io.NopCloser(strings.NewReader(body)),
					}, nil
				}),
			}

			if _, err := resolveBrowserWSURL(context.Background(), httpClient, noDNSLookup, "https://browser.example.com", 2*time.Second); !errors.Is(err, errBrowserFetchFailed) {
				t.Fatalf("body %s: expected errBrowserFetchFailed, got %v", body, err)
			}
		}
	})

	t.Run("rejects https to http redirect downgrade", func(t *testing.T) {
		httpsReq, _ := http.NewRequest(http.MethodGet, "https://browser.example.com/json/version", nil)
		httpReq, _ := http.NewRequest(http.MethodGet, "http://browser.example.com/json/version", nil)

		if err := browserDiscoveryRedirectPolicy(httpReq, []*http.Request{httpsReq}); !errors.Is(err, errBadRedirectURL) {
			t.Fatalf("expected errBadRedirectURL on https->http downgrade, got %v", err)
		}
	})
}
