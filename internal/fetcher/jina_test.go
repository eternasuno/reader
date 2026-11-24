package fetcher

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reader/internal/domain"
	"strings"
	"sync/atomic"
	"testing"
)

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
		Settings:            stubSettings(ExtractorSettings{Provider: domain.ProviderJina, JinaKey: &key}, nil),
		JinaBaseURL:         server.URL,
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
		Settings:            stubSettings(ExtractorSettings{Provider: domain.ProviderJina}, nil),
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
		Settings:            stubSettings(ExtractorSettings{Provider: domain.ProviderJina}, nil),
		JinaBaseURL:         server.URL,
	})

	_, _, err := client.FetchWebpage(context.Background(), mustNormalizedURL(t, "http://user:secret@example.com/article"))
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)

	if requests.Load() != 0 {
		t.Fatalf("expected no outbound requests, got %d", requests.Load())
	}
}
