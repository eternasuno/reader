package content

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"testing"
	"time"

	"reader/internal/domain"
)

const (
	directHTML          = "<p>direct</p>"
	directFinalURL      = "https://example.com/direct-final"
	browserlessHTML     = "<p>browserless</p>"
	browserlessFinalURL = "https://example.com/browserless-final"
	browserlessToken    = "tok-secret"
	browserlessBaseURL  = "https://browserless.example"
)

type fakeSettingsLoader struct {
	settings domain.Settings
	err      error
}

func (f fakeSettingsLoader) Get(context.Context) (domain.Settings, error) {
	return f.settings, f.err
}

type fakeWebpageFetcher struct {
	directErr      error
	browserlessErr error

	directCalls        int
	directDeadline     time.Time
	directHasDeadline  bool
	browserlessCalls   int
	browserlessService domain.BrowserlessSettings
}

func (f *fakeWebpageFetcher) FetchDirect(ctx context.Context, _ domain.NormalizedURL) (string, string, error) {
	f.directCalls++
	f.directDeadline, f.directHasDeadline = ctx.Deadline()

	if f.directErr != nil {
		return "", "", f.directErr
	}

	return directHTML, directFinalURL, nil
}

func (f *fakeWebpageFetcher) FetchBrowserless(_ context.Context, _ domain.NormalizedURL, service domain.BrowserlessSettings) (string, string, error) {
	f.browserlessCalls++
	f.browserlessService = service

	if f.browserlessErr != nil {
		return "", "", f.browserlessErr
	}

	return browserlessHTML, browserlessFinalURL, nil
}

type fakeArticleExtractor struct {
	errs  map[string]error
	pages []string
}

func (f *fakeArticleExtractor) ExtractArticle(htmlBody string, pageURL string) (domain.ExtractedArticle, error) {
	f.pages = append(f.pages, pageURL)

	if err := f.errs[htmlBody]; err != nil {
		return domain.ExtractedArticle{}, err
	}

	return domain.ExtractedArticle{Title: htmlBody}, nil
}

type webpageHarness struct {
	fetcher   *fakeWebpageFetcher
	articles  *fakeArticleExtractor
	extractor *WebpageExtractor
}

func newWebpageHarness(loader fakeSettingsLoader) *webpageHarness {
	fetcher := &fakeWebpageFetcher{}
	articles := &fakeArticleExtractor{errs: map[string]error{}}

	return &webpageHarness{
		fetcher:   fetcher,
		articles:  articles,
		extractor: NewWebpageExtractor(fetcher, articles, loader),
	}
}

func browserlessLoader() fakeSettingsLoader {
	token := browserlessToken

	return fakeSettingsLoader{settings: domain.Settings{
		Browserless: &domain.BrowserlessSettings{URL: browserlessBaseURL, Token: &token, ResidentialProxy: true},
	}}
}

func mustTarget(t *testing.T, rawURL string) domain.NormalizedURL {
	t.Helper()

	target, err := domain.ParseNormalizedURL(rawURL, domain.ErrInvalidPageUrl)
	if err != nil {
		t.Fatalf("parse %q: %v", rawURL, err)
	}

	return target
}

func requireBrowserlessCalls(t *testing.T, h *webpageHarness, want int) {
	t.Helper()

	if h.fetcher.browserlessCalls != want {
		t.Fatalf("expected %d browserless calls, got %d", want, h.fetcher.browserlessCalls)
	}
}

func TestExtractWebpageWithoutBrowserlessReturnsDirectFetchError(t *testing.T) {
	t.Parallel()

	fetchErr := domain.NewError(domain.ErrWebpageFetcherError, errors.New("connection refused"))
	h := newWebpageHarness(fakeSettingsLoader{})
	h.fetcher.directErr = fetchErr

	_, err := h.extractor.ExtractWebpage(context.Background(), mustTarget(t, "https://example.com/post"))
	if !errors.Is(err, fetchErr) {
		t.Fatalf("expected direct fetch error, got %v", err)
	}

	requireBrowserlessCalls(t, h, 0)

	if h.fetcher.directHasDeadline {
		t.Fatalf("expected no deadline without browserless, got %s", h.fetcher.directDeadline)
	}
}

func TestExtractWebpageDirectSuccessSkipsBrowserless(t *testing.T) {
	t.Parallel()

	h := newWebpageHarness(browserlessLoader())

	article, err := h.extractor.ExtractWebpage(context.Background(), mustTarget(t, "https://example.com/post"))
	if err != nil {
		t.Fatalf("expected direct extraction to succeed, got %v", err)
	}

	if article.Title != directHTML {
		t.Fatalf("expected the direct article, got %q", article.Title)
	}

	requireBrowserlessCalls(t, h, 0)

	if !slices.Equal(h.articles.pages, []string{directFinalURL}) {
		t.Fatalf("expected extraction of the direct final URL, got %v", h.articles.pages)
	}
}

func TestExtractWebpageBoundsDirectFetchWhenBrowserlessConfigured(t *testing.T) {
	t.Parallel()

	h := newWebpageHarness(browserlessLoader())

	if _, err := h.extractor.ExtractWebpage(context.Background(), mustTarget(t, "https://example.com/post")); err != nil {
		t.Fatalf("expected direct extraction to succeed, got %v", err)
	}

	if !h.fetcher.directHasDeadline {
		t.Fatal("expected the direct fetch to run under a deadline")
	}

	remaining := time.Until(h.fetcher.directDeadline)
	if remaining > 15*time.Second || remaining < 10*time.Second {
		t.Fatalf("expected a deadline about 15s away, got %s", remaining)
	}
}

func TestExtractWebpageFallsBackAfterDirectFetchError(t *testing.T) {
	t.Parallel()

	loader := browserlessLoader()
	h := newWebpageHarness(loader)
	h.fetcher.directErr = domain.NewError(domain.ErrWebpageFetcherError, errors.New("connection refused"))

	article, err := h.extractor.ExtractWebpage(context.Background(), mustTarget(t, "https://example.com/post"))
	if err != nil {
		t.Fatalf("expected browserless to succeed, got %v", err)
	}

	if article.Title != browserlessHTML {
		t.Fatalf("expected the browserless article, got %q", article.Title)
	}

	requireBrowserlessCalls(t, h, 1)

	if h.fetcher.browserlessService != *loader.settings.Browserless {
		t.Fatalf("expected the configured browserless settings, got %+v", h.fetcher.browserlessService)
	}

	if !slices.Equal(h.articles.pages, []string{browserlessFinalURL}) {
		t.Fatalf("expected extraction of the browserless final URL only, got %v", h.articles.pages)
	}
}

func TestExtractWebpageFallsBackAfterEmptyDirectContent(t *testing.T) {
	t.Parallel()

	h := newWebpageHarness(browserlessLoader())
	h.articles.errs[directHTML] = domain.NewError(domain.ErrArticleEmptyContent, nil)

	article, err := h.extractor.ExtractWebpage(context.Background(), mustTarget(t, "https://example.com/post"))
	if err != nil {
		t.Fatalf("expected browserless to succeed, got %v", err)
	}

	if article.Title != browserlessHTML {
		t.Fatalf("expected the browserless article, got %q", article.Title)
	}

	requireBrowserlessCalls(t, h, 1)

	if !slices.Equal(h.articles.pages, []string{directFinalURL, browserlessFinalURL}) {
		t.Fatalf("expected direct then browserless extraction, got %v", h.articles.pages)
	}
}

func TestExtractWebpageDoesNotFallBack(t *testing.T) {
	t.Parallel()

	blocked := domain.NewError(domain.ErrWebpageFetcherError, fmt.Errorf("dial tcp: %w", domain.ErrBlockedAddress))
	refused := domain.NewError(domain.ErrWebpageFetcherError, errors.New("connection refused"))
	extractorFailed := domain.NewError(domain.ErrArticleExtractorError, errors.New("parse failed"))

	tests := []struct {
		name       string
		rawURL     string
		canceled   bool
		fetchErr   error
		extractErr error
		wantErr    error
	}{
		{name: "blocked address", rawURL: "https://example.com/post", fetchErr: blocked, wantErr: blocked},
		{name: "article extractor error", rawURL: "https://example.com/post", extractErr: extractorFailed, wantErr: extractorFailed},
		{name: "credentialed target", rawURL: "https://user:pass@example.com/post", fetchErr: refused, wantErr: refused},
		{name: "canceled parent context", rawURL: "https://example.com/post", canceled: true, fetchErr: refused, wantErr: refused},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := newWebpageHarness(browserlessLoader())
			h.fetcher.directErr = tt.fetchErr
			h.articles.errs[directHTML] = tt.extractErr

			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			if tt.canceled {
				cancel()
			}

			_, err := h.extractor.ExtractWebpage(ctx, mustTarget(t, tt.rawURL))
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("expected the direct error %v, got %v", tt.wantErr, err)
			}

			requireBrowserlessCalls(t, h, 0)
		})
	}
}

func TestExtractWebpageReturnsBrowserlessFailure(t *testing.T) {
	t.Parallel()

	directErr := domain.NewError(domain.ErrWebpageFetcherError, errors.New("connection refused"))
	browserlessErr := domain.NewError(domain.ErrWebpageFetcherError, errors.New("unblock failed"))

	tests := []struct {
		name  string
		setup func(h *webpageHarness)
	}{
		{name: "fetch failure", setup: func(h *webpageHarness) { h.fetcher.browserlessErr = browserlessErr }},
		{name: "extraction failure", setup: func(h *webpageHarness) { h.articles.errs[browserlessHTML] = browserlessErr }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			h := newWebpageHarness(browserlessLoader())
			h.fetcher.directErr = directErr
			tt.setup(h)

			_, err := h.extractor.ExtractWebpage(context.Background(), mustTarget(t, "https://example.com/post"))
			if !errors.Is(err, browserlessErr) {
				t.Fatalf("expected the browserless error, got %v", err)
			}

			if errors.Is(err, directErr) {
				t.Fatalf("expected the direct error to be replaced, got %v", err)
			}
		})
	}
}

func TestExtractWebpageReturnsSettingsErrorWithoutFetching(t *testing.T) {
	t.Parallel()

	loadErr := errors.New("settings unavailable")
	h := newWebpageHarness(fakeSettingsLoader{err: loadErr})

	_, err := h.extractor.ExtractWebpage(context.Background(), mustTarget(t, "https://example.com/post"))
	if !errors.Is(err, loadErr) {
		t.Fatalf("expected the settings error, got %v", err)
	}

	if h.fetcher.directCalls != 0 {
		t.Fatalf("expected no direct fetch, got %d", h.fetcher.directCalls)
	}

	requireBrowserlessCalls(t, h, 0)
}

func TestExtractWebpageLogsFallbackWithoutSecrets(t *testing.T) {
	tests := []struct {
		name       string
		fetchErr   error
		wantReason string
	}{
		{
			name:       "domain error code",
			fetchErr:   domain.NewError(domain.ErrWebpageFetcherError, errors.New("connection refused")),
			wantReason: "reason=WebpageFetcherError",
		},
		{
			name:       "plain error text withheld",
			fetchErr:   errors.New("fetch https://user:pass@example.com/err-path?key=errsecret failed"),
			wantReason: `reason="fetch failed"`,
		},
	}

	for _, tt := range tests {
		// Replaces the process-wide slog default, so these subtests stay serial.
		t.Run(tt.name, func(t *testing.T) {
			var logs bytes.Buffer

			previous := slog.Default()
			slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
			t.Cleanup(func() { slog.SetDefault(previous) })

			h := newWebpageHarness(browserlessLoader())
			h.fetcher.directErr = tt.fetchErr

			target := mustTarget(t, "https://example.com/articles/42?session=s3cret")
			if _, err := h.extractor.ExtractWebpage(context.Background(), target); err != nil {
				t.Fatalf("expected browserless to succeed, got %v", err)
			}

			output := logs.String()
			requireContains(t, output, `msg="webpage direct fetch failed, retrying with browserless"`)
			requireContains(t, output, "host=example.com")
			requireContains(t, output, tt.wantReason)
			requireNotContains(t, output, browserlessToken)
			requireNotContains(t, output, browserlessBaseURL)
			requireNotContains(t, output, "s3cret")
			requireNotContains(t, output, "/articles/42")
			requireNotContains(t, output, "user:pass")
			requireNotContains(t, output, "/err-path")
			requireNotContains(t, output, "errsecret")
		})
	}
}
