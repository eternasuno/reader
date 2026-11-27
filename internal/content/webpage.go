package content

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"reader/internal/domain"
)

const (
	directFetchTimeoutWithBrowserless = 15 * time.Second
	nonDomainFailureReason            = "fetch failed"
)

// SettingsLoader reads the current settings on each extraction.
type SettingsLoader interface {
	Get(ctx context.Context) (domain.Settings, error)
}

// WebpageExtractor fetches pages directly and falls back to Browserless.
type WebpageExtractor struct {
	fetcher  domain.WebpageFetcher
	articles domain.ArticleExtractor
	settings SettingsLoader
}

var _ domain.WebpageExtractor = (*WebpageExtractor)(nil)

func NewWebpageExtractor(fetcher domain.WebpageFetcher, articles domain.ArticleExtractor, settings SettingsLoader) *WebpageExtractor {
	return &WebpageExtractor{fetcher: fetcher, articles: articles, settings: settings}
}

// ExtractWebpage fetches target directly and retries once through Browserless
// when it is configured and the direct attempt failed in a way a browser can fix.
func (e *WebpageExtractor) ExtractWebpage(ctx context.Context, target domain.NormalizedURL) (domain.ExtractedArticle, error) {
	settings, err := e.settings.Get(ctx)
	if err != nil {
		return domain.ExtractedArticle{}, err
	}

	article, failure := e.extractDirect(ctx, target, settings.Browserless)
	if failure == nil {
		return article, nil
	}

	if settings.Browserless == nil || !shouldFallBack(ctx, target, failure) {
		return domain.ExtractedArticle{}, failure.err
	}

	slog.Info("webpage direct fetch failed, retrying with browserless", "host", target.Host(), "reason", failureReason(failure.err))

	return e.extractBrowserless(ctx, target, *settings.Browserless)
}

type directFailure struct {
	err      error
	fetching bool
}

func (f *directFailure) retryable() bool {
	if f.fetching {
		return !errors.Is(f.err, domain.ErrBlockedAddress)
	}

	code, ok := domainCode(f.err)

	return ok && code == domain.ErrArticleEmptyContent
}

func shouldFallBack(ctx context.Context, target domain.NormalizedURL, failure *directFailure) bool {
	return ctx.Err() == nil && !target.HasCredentials() && failure.retryable()
}

func (e *WebpageExtractor) extractDirect(ctx context.Context, target domain.NormalizedURL, browserless *domain.BrowserlessSettings) (domain.ExtractedArticle, *directFailure) {
	htmlBody, finalURL, err := e.fetchDirect(ctx, target, browserless)
	if err != nil {
		return domain.ExtractedArticle{}, &directFailure{err: err, fetching: true}
	}

	article, err := e.articles.ExtractArticle(htmlBody, finalURL)
	if err != nil {
		return domain.ExtractedArticle{}, &directFailure{err: err}
	}

	return article, nil
}

func (e *WebpageExtractor) fetchDirect(ctx context.Context, target domain.NormalizedURL, browserless *domain.BrowserlessSettings) (string, string, error) {
	fetchCtx := ctx

	if browserless != nil {
		var cancel context.CancelFunc

		fetchCtx, cancel = context.WithTimeout(ctx, directFetchTimeoutWithBrowserless)
		defer cancel()
	}

	return e.fetcher.FetchDirect(fetchCtx, target)
}

func (e *WebpageExtractor) extractBrowserless(ctx context.Context, target domain.NormalizedURL, service domain.BrowserlessSettings) (domain.ExtractedArticle, error) {
	htmlBody, finalURL, err := e.fetcher.FetchBrowserless(ctx, target, service)
	if err != nil {
		return domain.ExtractedArticle{}, err
	}

	return e.articles.ExtractArticle(htmlBody, finalURL)
}

func domainCode(err error) (domain.ErrorCode, bool) {
	var domainErr *domain.DomainError
	if !errors.As(err, &domainErr) {
		return "", false
	}

	return domainErr.Code, true
}

func failureReason(err error) string {
	if code, ok := domainCode(err); ok {
		return string(code)
	}

	return nonDomainFailureReason
}
