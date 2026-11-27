package fetcher

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"reader/internal/domain"
)

const (
	testBrowserlessToken = "tok-s3cret/+value"
	testBrowserlessPage  = "https://example.com/article"
)

type recordedBrowserlessRequest struct {
	method      string
	path        string
	query       url.Values
	contentType string
	accept      string
	body        map[string]any
}

func browserlessServer(t *testing.T, status int, response string) (*httptest.Server, *recordedBrowserlessRequest, *atomic.Int32) {
	t.Helper()

	recorded := &recordedBrowserlessRequest{}
	hits := &atomic.Int32{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)

		raw, _ := io.ReadAll(r.Body)
		recorded.method = r.Method
		recorded.path = r.URL.Path
		recorded.query = r.URL.Query()
		recorded.contentType = r.Header.Get("Content-Type")
		recorded.accept = r.Header.Get("Accept")
		_ = json.Unmarshal(raw, &recorded.body)

		w.WriteHeader(status)
		_, _ = w.Write([]byte(response))
	}))
	t.Cleanup(server.Close)

	return server, recorded, hits
}

func TestFetchBrowserlessRequestShape(t *testing.T) {
	server, got, _ := browserlessServer(t, http.StatusOK, `{"content":"<html><body>rendered</body></html>"}`)
	client := New(Config{BrowserlessTimeout: 20 * time.Second})
	service := domain.BrowserlessSettings{URL: server.URL, Token: ptr(testBrowserlessToken), ResidentialProxy: true}

	body, finalURL, err := client.FetchBrowserless(context.Background(), mustNormalizedURL(t, testBrowserlessPage), service)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if body != "<html><body>rendered</body></html>" || finalURL != testBrowserlessPage {
		t.Fatalf("unexpected result %q %q", body, finalURL)
	}

	if got.method != http.MethodPost || got.path != "/unblock" {
		t.Fatalf("unexpected request %s %s", got.method, got.path)
	}

	if got.contentType != "application/json" || got.accept != "application/json" {
		t.Fatalf("unexpected headers %q %q", got.contentType, got.accept)
	}

	if got.query.Get("timeout") != "18000" || got.query.Get("token") != testBrowserlessToken || got.query.Get("proxy") != "residential" {
		t.Fatalf("unexpected query %v", got.query)
	}

	want := map[string]any{"url": testBrowserlessPage, "content": true, "cookies": false, "screenshot": false, "browserWSEndpoint": false}
	if len(got.body) != len(want) {
		t.Fatalf("unexpected body %v", got.body)
	}

	for key, value := range want {
		if got.body[key] != value {
			t.Fatalf("body[%q] = %v, want %v", key, got.body[key], value)
		}
	}
}

func TestFetchBrowserlessOptionalQueryOmitted(t *testing.T) {
	server, got, _ := browserlessServer(t, http.StatusOK, `{"content":"<p>x</p>"}`)
	client := New(Config{})

	_, _, err := client.FetchBrowserless(context.Background(), mustNormalizedURL(t, testBrowserlessPage), domain.BrowserlessSettings{URL: server.URL})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if got.query.Has("token") || got.query.Has("proxy") {
		t.Fatalf("unexpected optional query %v", got.query)
	}

	if got.query.Get("timeout") != "43000" {
		t.Fatalf("unexpected default timeout %q", got.query.Get("timeout"))
	}
}

func TestFetchBrowserlessBudgetFromContextDeadline(t *testing.T) {
	server, got, _ := browserlessServer(t, http.StatusOK, `{"content":"<p>x</p>"}`)
	client := New(Config{})

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	_, _, err := client.FetchBrowserless(ctx, mustNormalizedURL(t, testBrowserlessPage), domain.BrowserlessSettings{URL: server.URL})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	timeout, parseErr := time.ParseDuration(got.query.Get("timeout") + "ms")
	if parseErr != nil || timeout > 15*time.Second || timeout < 14*time.Second {
		t.Fatalf("expected timeout near 15s, got %q (%v)", got.query.Get("timeout"), parseErr)
	}
}

func TestFetchBrowserlessBasePathPrefix(t *testing.T) {
	server, got, _ := browserlessServer(t, http.StatusOK, `{"content":"<p>x</p>"}`)
	client := New(Config{})

	_, _, err := client.FetchBrowserless(context.Background(), mustNormalizedURL(t, testBrowserlessPage), domain.BrowserlessSettings{URL: server.URL + "/chrome/v2"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if got.path != "/chrome/v2/unblock" {
		t.Fatalf("unexpected path %q", got.path)
	}
}

func TestFetchBrowserlessErrors(t *testing.T) {
	cases := []struct {
		name     string
		status   int
		response string
		max      int64
		wantErr  error
		wantText string
	}{
		{name: "non 2xx", status: http.StatusUnauthorized, response: "token " + testBrowserlessToken + " rejected", wantText: "unexpected status code 401"},
		{name: "empty content", status: http.StatusOK, response: `{"content":""}`, wantErr: errEmptyResponseBody},
		{name: "missing content", status: http.StatusOK, response: `{}`, wantErr: errEmptyResponseBody},
		{name: "content too large", status: http.StatusOK, response: `{"content":"` + strings.Repeat("a", 33) + `"}`, max: 32, wantErr: errResponseTooLarge},
		{name: "envelope too large", status: http.StatusOK, response: `{"content":"a","padding":"` + strings.Repeat("a", 64) + `"}`, max: 8, wantErr: errResponseTooLarge},
		{name: "invalid json", status: http.StatusOK, response: "<html>not json</html>", wantErr: errBrowserlessBadPayload},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server, _, _ := browserlessServer(t, tc.status, tc.response)
			client := New(Config{MaxBodyBytes: tc.max})
			service := domain.BrowserlessSettings{URL: server.URL, Token: ptr(testBrowserlessToken)}

			body, finalURL, err := client.FetchBrowserless(context.Background(), mustNormalizedURL(t, testBrowserlessPage), service)
			requireDomainCode(t, err, domain.ErrWebpageFetcherError)

			if body != "" || finalURL != "" {
				t.Fatalf("expected empty results, got %q %q", body, finalURL)
			}

			if tc.wantErr != nil && !errors.Is(err, tc.wantErr) {
				t.Fatalf("expected %v, got %v", tc.wantErr, err)
			}

			if tc.wantText != "" && !strings.Contains(err.Error(), tc.wantText) {
				t.Fatalf("expected %q in %v", tc.wantText, err)
			}

			requireNoSecrets(t, err, server.URL)
		})
	}
}

func TestFetchBrowserlessRedirectNotFollowed(t *testing.T) {
	var targetHits atomic.Int32

	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		targetHits.Add(1)
		_, _ = w.Write([]byte(`{"content":"<p>leaked</p>"}`))
	}))
	defer target.Close()

	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL+"/unblock?"+r.URL.RawQuery, http.StatusTemporaryRedirect)
	}))
	defer redirector.Close()

	client := New(Config{})
	service := domain.BrowserlessSettings{URL: redirector.URL, Token: ptr(testBrowserlessToken)}

	_, _, err := client.FetchBrowserless(context.Background(), mustNormalizedURL(t, testBrowserlessPage), service)
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)

	if !strings.Contains(err.Error(), "unexpected status code 307") {
		t.Fatalf("expected redirect to count as non-2xx, got %v", err)
	}

	if targetHits.Load() != 0 {
		t.Fatal("redirect target must never be contacted")
	}

	requireNoSecrets(t, err, redirector.URL)
}

func TestFetchBrowserlessMalformedRedirectHidesToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "http://[::1%zz/?"+r.URL.RawQuery)
		w.WriteHeader(http.StatusFound)
	}))
	defer server.Close()

	client := New(Config{})
	service := domain.BrowserlessSettings{URL: server.URL, Token: ptr(testBrowserlessToken)}

	_, _, err := client.FetchBrowserless(context.Background(), mustNormalizedURL(t, testBrowserlessPage), service)
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)
	requireNoSecrets(t, err, server.URL)

	if !errors.Is(err, errBrowserlessTransport) {
		t.Fatalf("expected the fixed transport error, got %v", err)
	}
}

func TestFetchBrowserlessTruncatedBodyIsTransportError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", "100")
		_, _ = w.Write([]byte(`{"content":`))
		w.(http.Flusher).Flush()
		panic(http.ErrAbortHandler)
	}))
	defer server.Close()

	client := New(Config{})
	service := domain.BrowserlessSettings{URL: server.URL, Token: ptr(testBrowserlessToken)}

	_, _, err := client.FetchBrowserless(context.Background(), mustNormalizedURL(t, testBrowserlessPage), service)
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)

	if !errors.Is(err, errBrowserlessTransport) {
		t.Fatalf("expected the fixed transport error, got %v", err)
	}

	requireNoSecrets(t, err, server.URL)
}

func TestFetchBrowserlessBudgetTooSmall(t *testing.T) {
	server, _, hits := browserlessServer(t, http.StatusOK, `{"content":"<p>x</p>"}`)
	client := New(Config{})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, _, err := client.FetchBrowserless(ctx, mustNormalizedURL(t, testBrowserlessPage), domain.BrowserlessSettings{URL: server.URL})
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)

	if !errors.Is(err, errBrowserlessBudget) || hits.Load() != 0 {
		t.Fatalf("expected immediate budget failure without a request, got %v (hits=%d)", err, hits.Load())
	}
}

func TestFetchBrowserlessBudgetBoundary(t *testing.T) {
	server, _, hits := browserlessServer(t, http.StatusOK, `{"content":"<p>x</p>"}`)
	client := New(Config{BrowserlessTimeout: 7 * time.Second})

	_, _, err := client.FetchBrowserless(context.Background(), mustNormalizedURL(t, testBrowserlessPage), domain.BrowserlessSettings{URL: server.URL})
	if !errors.Is(err, errBrowserlessBudget) || hits.Load() != 0 {
		t.Fatalf("expected configured budget below 8s to fail, got %v (hits=%d)", err, hits.Load())
	}
}

func TestFetchBrowserlessConnectionErrorHidesToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	serverURL := server.URL
	server.Close()

	client := New(Config{})
	service := domain.BrowserlessSettings{URL: serverURL, Token: ptr(testBrowserlessToken), ResidentialProxy: true}

	_, _, err := client.FetchBrowserless(context.Background(), mustNormalizedURL(t, testBrowserlessPage), service)
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)
	requireNoSecrets(t, err, serverURL)
}

func TestFetchBrowserlessCancelHidesToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		<-r.Context().Done()
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(50*time.Millisecond, cancel)

	client := New(Config{})
	service := domain.BrowserlessSettings{URL: server.URL, Token: ptr(testBrowserlessToken)}

	_, _, err := client.FetchBrowserless(ctx, mustNormalizedURL(t, testBrowserlessPage), service)
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context canceled, got %v", err)
	}

	requireNoSecrets(t, err, server.URL)
}

func TestFetchBrowserlessInvalidEndpoint(t *testing.T) {
	client := New(Config{})

	_, _, err := client.FetchBrowserless(context.Background(), mustNormalizedURL(t, testBrowserlessPage), domain.BrowserlessSettings{URL: "://bad"})
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)

	if !errors.Is(err, errBrowserlessEndpoint) {
		t.Fatalf("expected endpoint error, got %v", err)
	}
}

func TestFetchBrowserlessRefusesCredentialedTarget(t *testing.T) {
	server, _, hits := browserlessServer(t, http.StatusOK, `{"content":"<p>x</p>"}`)
	client := New(Config{})

	target := mustNormalizedURL(t, "https://pageuser:pagesecret@example.com/private")
	_, _, err := client.FetchBrowserless(context.Background(), target, domain.BrowserlessSettings{URL: server.URL})
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)

	if !errors.Is(err, errExternalCredentials) || hits.Load() != 0 {
		t.Fatalf("expected credentialed target refused without a request, got %v (hits=%d)", err, hits.Load())
	}

	if strings.Contains(err.Error(), "pagesecret") {
		t.Fatalf("error leaks credentials: %v", err)
	}
}

func TestFetchBrowserlessAllowsPrivateEndpoint(t *testing.T) {
	server, _, hits := browserlessServer(t, http.StatusOK, `{"content":"<p>x</p>"}`)
	client := New(Config{AllowPrivateNetwork: false})

	if _, _, err := client.FetchBrowserless(context.Background(), mustNormalizedURL(t, testBrowserlessPage), domain.BrowserlessSettings{URL: server.URL}); err != nil {
		t.Fatalf("expected loopback browserless endpoint to be reachable: %v", err)
	}

	if hits.Load() != 1 {
		t.Fatalf("expected one request, got %d", hits.Load())
	}
}

func requireNoSecrets(t *testing.T, err error, endpoint string) {
	t.Helper()

	for _, link := range errorChain(err) {
		text := link.Error()
		for _, secret := range []string{testBrowserlessToken, url.QueryEscape(testBrowserlessToken), "token=", endpoint} {
			if strings.Contains(text, secret) {
				t.Fatalf("error %T leaks %q: %v", link, secret, link)
			}
		}
	}
}

func errorChain(err error) []error {
	chain := []error{err}

	switch wrapped := err.(type) { //nolint:errorlint // the walker inspects each link's own Unwrap method, not the chain behind it
	case interface{ Unwrap() error }:
		if inner := wrapped.Unwrap(); inner != nil {
			chain = append(chain, errorChain(inner)...)
		}
	case interface{ Unwrap() []error }:
		for _, inner := range wrapped.Unwrap() {
			chain = append(chain, errorChain(inner)...)
		}
	}

	return chain
}
