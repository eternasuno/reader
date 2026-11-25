package fetcher

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reader/internal/domain"
	"strings"
	"testing"
	"time"
)

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

	t.Run("non 2xx skips body buffering", func(t *testing.T) {
		client := New(Config{AllowPrivateNetwork: true, MaxBodyBytes: 1})
		_, _, err := client.FetchFeed(context.Background(), mustNormalizedURL(t, server.URL+"/missing.xml"))
		requireDomainCode(t, err, domain.ErrFetchFeedError)

		if !strings.Contains(err.Error(), "unexpected status code 500") {
			t.Fatalf("expected status code error before body read, got %v", err)
		}
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

		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("expected deadline exceeded, got %v", err)
		}
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
	client := New(Config{AllowPrivateNetwork: true, Settings: stubSettings(ExtractorSettings{}, errors.New("settings unavailable"))})
	_, _, err := client.FetchWebpage(context.Background(), mustNormalizedURL(t, "http://example.com/page"))
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)
}

func TestFetchStatusCheckedBeforeBufferingBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(strings.Repeat("x", 128)))
	}))
	defer server.Close()

	client := New(Config{AllowPrivateNetwork: true, MaxBodyBytes: 8})
	_, _, err := client.FetchWebpage(context.Background(), mustNormalizedURL(t, server.URL+"/err"))
	requireDomainCode(t, err, domain.ErrWebpageFetcherError)

	if !strings.Contains(err.Error(), "unexpected status code 500") {
		t.Fatalf("expected status error before reading oversize body, got: %v", err)
	}
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
		{"gif89a", []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;"), "image/gif", ".gif"},
		{"gif87a", []byte("GIF87a\x01\x00\x01\x00\x00\x00\x00;"), "image/gif", ".gif"},
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
		if err == nil || !strings.Contains(err.Error(), "unexpected status code 404") {
			t.Fatalf("expected status 404 error, got %v", err)
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

func TestFetchBoundaries(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/redirect":
			http.Redirect(w, r, "/redirect", http.StatusFound)
		case "/slow":
			<-r.Context().Done()
		case "/large":
			_, _ = w.Write([]byte("oversized body"))
		default:
			w.WriteHeader(http.StatusBadGateway)
		}
	}))
	defer server.Close()

	for _, kind := range []string{"feed", "webpage", "image"} {
		for _, scenario := range []string{"redirect", "slow", "large", "status"} {
			t.Run(kind+"/"+scenario, func(t *testing.T) {
				client := New(Config{AllowPrivateNetwork: true, MaxBodyBytes: 4, FeedTimeout: 30 * time.Millisecond, WebpageTimeout: 30 * time.Millisecond, ImageTimeout: 30 * time.Millisecond})
				target := strings.Replace(server.URL, "http://", "http://user:secret@", 1) + "/" + scenario
				var err error
				switch kind {
				case "feed":
					_, _, err = client.FetchFeed(context.Background(), mustNormalizedURL(t, target))
				case "webpage":
					_, _, err = client.FetchWebpage(context.Background(), mustNormalizedURL(t, target))
				case "image":
					_, _, _, err = client.FetchImage(context.Background(), target)
				}

				if err == nil {
					t.Fatal("expected fetch failure")
				}

				if strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "user:") {
					t.Fatalf("error leaks credentials: %v", err)
				}

				switch scenario {
				case "redirect":
					if !errors.Is(err, errTooManyRedirects) {
						t.Fatalf("expected redirect limit: %v", err)
					}
				case "slow":
					if !errors.Is(err, context.DeadlineExceeded) {
						t.Fatalf("expected timeout: %v", err)
					}
				case "large":
					if !errors.Is(err, errResponseTooLarge) {
						t.Fatalf("expected size limit: %v", err)
					}
				case "status":
					if !strings.Contains(err.Error(), "unexpected status code 502") {
						t.Fatalf("expected status error: %v", err)
					}
				}
			})
		}
	}
}
