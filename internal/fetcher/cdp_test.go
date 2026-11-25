package fetcher

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reader/internal/domain"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestFetchWebpageBrowser(t *testing.T) {
	var gotEndpoint string
	var gotTarget string
	var gotTimeout time.Duration
	called := false

	client := New(Config{
		AllowPrivateNetwork: true,
		Settings: stubSettings(ExtractorSettings{
			Provider:        domain.ProviderBrowser,
			BrowserEndpoint: ptr("ws://browser.internal:9222"),
		}, nil),
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
		Settings: stubSettings(ExtractorSettings{
			Provider:        domain.ProviderBrowser,
			BrowserEndpoint: ptr("ws://browser.internal:9222"),
		}, nil),
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
	t.Run("sanitizes endpoint from failure", func(t *testing.T) {
		endpoint := "ws://token:browser-secret@browser.internal:9222/devtools/browser/abc"
		client := New(Config{
			AllowPrivateNetwork: true,
			Settings: stubSettings(ExtractorSettings{
				Provider:        domain.ProviderBrowser,
				BrowserEndpoint: ptr(endpoint),
			}, nil),
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
			Settings: stubSettings(ExtractorSettings{
				Provider:        domain.ProviderBrowser,
				BrowserEndpoint: ptr(endpoint),
			}, nil),
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
			Settings: stubSettings(ExtractorSettings{
				Provider:        domain.ProviderBrowser,
				BrowserEndpoint: ptr("ws://browser.internal:9222"),
			}, nil),
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

func TestClassifyBrowserError(t *testing.T) {
	if err := classifyBrowserError(fmt.Errorf("wrapped: %w", context.DeadlineExceeded)); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected DeadlineExceeded, got %v", err)
	}

	if err := classifyBrowserError(fmt.Errorf("wrapped: %w", context.Canceled)); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected Canceled, got %v", err)
	}

	if err := classifyBrowserError(fmt.Errorf("wrapped: %w", errResponseTooLarge)); !errors.Is(err, errResponseTooLarge) {
		t.Fatalf("expected errResponseTooLarge, got %v", err)
	}

	if err := classifyBrowserError(errors.New("ws://secret:pw@internal:9222 failed")); !errors.Is(err, errBrowserFetchFailed) {
		t.Fatalf("expected errBrowserFetchFailed, got %v", err)
	}
}

func TestRunBrowserFetchCreatesAndDisposesBrowserContext(t *testing.T) {
	type cdpCall struct {
		Method string
		Params map[string]any
	}

	var (
		mu    sync.Mutex
		calls []cdpCall
	)

	recordCall := func(method string, params map[string]any) {
		mu.Lock()
		defer mu.Unlock()
		calls = append(calls, cdpCall{Method: method, Params: params})
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("Sec-WebSocket-Key")
		sum := sha1.Sum([]byte(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")) //nolint:gosec // RFC 6455 WebSocket accept hash.
		accept := base64.StdEncoding.EncodeToString(sum[:])

		hj, ok := w.(http.Hijacker)
		if !ok {
			http.Error(w, "hijack unsupported", http.StatusInternalServerError)
			return
		}

		conn, rw, err := hj.Hijack()
		if err != nil {
			return
		}
		defer conn.Close()

		_, _ = fmt.Fprintf(
			rw,
			"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n",
			accept,
		)
		_ = rw.Flush()

		for {
			payload, ok := readWSFrame(rw.Reader)
			if !ok {
				return
			}

			var req struct {
				ID        int64          `json:"id"`
				Method    string         `json:"method"`
				Params    map[string]any `json:"params"`
				SessionID string         `json:"sessionId"`
			}
			if err := json.Unmarshal(payload, &req); err != nil {
				return
			}

			recordCall(req.Method, req.Params)

			resp := map[string]any{"id": req.ID, "result": map[string]any{}}
			if req.SessionID != "" {
				resp["sessionId"] = req.SessionID
			}

			switch req.Method {
			case "Target.createBrowserContext":
				resp["result"] = map[string]any{"browserContextId": "bc-isolated-1"}
			case "Target.createTarget":
				resp["result"] = map[string]any{"targetId": "target-1"}
			case "Target.attachToTarget":
				resp["result"] = map[string]any{"sessionId": "session-1"}
			case "Runtime.evaluate":
				resp["result"] = map[string]any{"result": map[string]any{"type": "object", "className": "Window"}}
			case "Page.getFrameTree":
				resp["result"] = map[string]any{"frameTree": map[string]any{"frame": map[string]any{"id": "frame-1"}}}
			case "Target.getTargets":
				resp["result"] = map[string]any{"targetInfos": []any{}}
			case "Page.navigate":
				if urlParam, _ := req.Params["url"].(string); strings.Contains(urlParam, "hang") {
					select {
					case <-r.Context().Done():
						return
					case <-time.After(100 * time.Millisecond):
					}
				}
				delete(resp, "result")
				resp["error"] = map[string]any{"code": -32000, "message": "simulated navigation stop"}
			}

			encoded, err := json.Marshal(resp)
			if err != nil {
				return
			}

			if !writeWSFrame(rw.Writer, encoded) {
				return
			}
		}
	}))
	defer server.Close()

	wsEndpoint := "ws" + strings.TrimPrefix(server.URL, "http") + "/devtools/browser/test"

	checkIsolation := func(t *testing.T, run func() error) {
		t.Helper()

		mu.Lock()
		calls = nil
		mu.Unlock()

		if err := run(); err == nil {
			t.Fatal("expected error from simulated CDP server")
		}

		mu.Lock()
		defer mu.Unlock()

		var createdIsolated, targetedIsolated, disposedIsolated bool
		for _, call := range calls {
			switch call.Method {
			case "Target.createBrowserContext":
				if disposeOnDetach, _ := call.Params["disposeOnDetach"].(bool); disposeOnDetach {
					createdIsolated = true
				}
			case "Target.createTarget":
				if call.Params["browserContextId"] == "bc-isolated-1" {
					targetedIsolated = true
				}
			case "Target.disposeBrowserContext":
				if call.Params["browserContextId"] == "bc-isolated-1" {
					disposedIsolated = true
				}
			}
		}

		if !createdIsolated {
			t.Fatalf("expected Target.createBrowserContext with disposeOnDetach=true; calls=%+v", calls)
		}

		if !targetedIsolated {
			t.Fatalf("expected Target.createTarget with isolated browserContextId; calls=%+v", calls)
		}

		if !disposedIsolated {
			t.Fatalf("expected Target.disposeBrowserContext on exit; calls=%+v", calls)
		}
	}

	t.Run("completion", func(t *testing.T) {
		checkIsolation(t, func() error {
			_, _, err := runBrowserFetch(context.Background(), wsEndpoint, "https://example.com/page", 5*time.Second, 1024)
			if !errors.Is(err, errBrowserFetchFailed) {
				t.Fatalf("expected errBrowserFetchFailed, got %v", err)
			}

			return err
		})
	})

	t.Run("timeout", func(t *testing.T) {
		checkIsolation(t, func() error {
			_, _, err := runBrowserFetch(context.Background(), wsEndpoint, "https://example.com/hang", 20*time.Millisecond, 1024)
			if !errors.Is(err, context.DeadlineExceeded) && !errors.Is(err, context.Canceled) {
				t.Fatalf("expected timeout/cancel error, got %v", err)
			}

			return err
		})
	})
}
func TestRunBrowserFetchDiscoverySafety(t *testing.T) {
	t.Run("missing webSocketDebuggerUrl does not panic", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{}`))
		}))
		defer server.Close()

		_, _, err := runBrowserFetch(context.Background(), server.URL, "https://example.com/page", 2*time.Second, 1024)
		if !errors.Is(err, errBrowserFetchFailed) {
			t.Fatalf("expected errBrowserFetchFailed, got %v", err)
		}
	})

	t.Run("non-string webSocketDebuggerUrl does not panic", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"webSocketDebuggerUrl": 12345}`))
		}))
		defer server.Close()

		_, _, err := runBrowserFetch(context.Background(), server.URL, "https://example.com/page", 2*time.Second, 1024)
		if !errors.Is(err, errBrowserFetchFailed) {
			t.Fatalf("expected errBrowserFetchFailed, got %v", err)
		}
	})

	t.Run("oversized discovery body is rejected", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = fmt.Fprintf(w, `{"webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/browser/1","pad":%q}`, strings.Repeat("a", 65*1024))
		}))
		defer server.Close()

		_, _, err := runBrowserFetch(context.Background(), server.URL, "https://example.com/page", 2*time.Second, 1024)
		if !errors.Is(err, errResponseTooLarge) {
			t.Fatalf("expected errResponseTooLarge, got %v", err)
		}
	})

	t.Run("endpoint text is not leaked on discovery failure", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "bad gateway", http.StatusBadGateway)
		}))
		defer server.Close()

		parsed, err := url.Parse(server.URL)
		if err != nil {
			t.Fatalf("parse server url: %v", err)
		}
		parsed.User = url.UserPassword("cdpuser", "cdpsecret")
		parsed.RawQuery = "token=querysecret"

		_, _, err = runBrowserFetch(context.Background(), parsed.String(), "https://example.com/page", 2*time.Second, 1024)
		if !errors.Is(err, errBrowserFetchFailed) {
			t.Fatalf("expected errBrowserFetchFailed, got %v", err)
		}

		for _, leaked := range []string{"cdpuser", "cdpsecret", "querysecret", parsed.Host} {
			if strings.Contains(err.Error(), leaked) {
				t.Fatalf("discovery error leaks %q: %v", leaked, err)
			}
		}
	})
}
