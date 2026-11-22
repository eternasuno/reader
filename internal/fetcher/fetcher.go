package fetcher

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/chromedp"
	"github.com/chromedp/chromedp/remote"

	"reader/internal/domain"
)

const (
	defaultFeedTimeout    = 15 * time.Second
	defaultWebpageTimeout = 20 * time.Second
	defaultImageTimeout   = 15 * time.Second
	defaultMaxBodyBytes   = 10 * 1024 * 1024
	defaultJinaBaseURL    = "https://r.jina.ai/"
	defaultUserAgent      = "LiubaiReader/1.0"

	feedAccept    = "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*"
	webpageAccept = "text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8"
	imageAccept   = "image/jpeg, image/png, image/gif, image/*;q=0.8, */*;q=0.1"
	jinaAccept    = "text/html, text/plain, */*"

	browserHTMLScript = `(() => {
  const html = document.documentElement ? document.documentElement.outerHTML : '';
  if (new TextEncoder().encode(html).length > %d) {
    return { html: '', tooLarge: true };
  }
  return { html, tooLarge: false };
})()`
)

var (
	errEmptyURL             = errors.New("url is empty")
	errBrowserEndpointUnset = errors.New("browser endpoint is not configured")
	errBrowserEndpointBad   = errors.New("browser endpoint is invalid")
	errExternalCredentials  = errors.New("refusing to forward credentialed url to external provider")
	errEmptyResponseBody    = errors.New("empty response body")
	errUnsupportedImage     = errors.New("unsupported image media type")
	errBrowserFetchFailed   = errors.New("browser webpage fetch failed")

	userInfoPattern = regexp.MustCompile(`(?i)((?:https?|wss?)://)[^/\s?#"']+@`)
)

type browserSnapshot struct {
	HTML     string `json:"html"`
	TooLarge bool   `json:"tooLarge"`
}

type BrowserFetchFunc func(ctx context.Context, endpoint string, targetURL string, timeout time.Duration) (htmlBody string, finalURL string, err error)

type Config struct {
	AllowPrivateNetwork bool
	Settings            domain.SettingRepository
	FeedTimeout         time.Duration
	WebpageTimeout      time.Duration
	ImageTimeout        time.Duration
	MaxBodyBytes        int64
	JinaBaseURL         string
	UserAgent           string
	BrowserFetch        BrowserFetchFunc
}

type Client struct {
	httpClient     *http.Client
	settings       domain.SettingRepository
	feedTimeout    time.Duration
	webpageTimeout time.Duration
	imageTimeout   time.Duration
	maxBodyBytes   int64
	jinaBaseURL    string
	userAgent      string
	browserFetch   BrowserFetchFunc
}

type fetchResult struct {
	status   int
	body     []byte
	finalURL *url.URL
}

var (
	_ domain.FeedFetcher    = (*Client)(nil)
	_ domain.WebpageFetcher = (*Client)(nil)
	_ domain.ImageFetcher   = (*Client)(nil)
)

func New(cfg Config) *Client {
	resolved := applyConfigDefaults(cfg)

	return &Client{
		httpClient:     newHTTPClient(resolved.AllowPrivateNetwork),
		settings:       resolved.Settings,
		feedTimeout:    resolved.FeedTimeout,
		webpageTimeout: resolved.WebpageTimeout,
		imageTimeout:   resolved.ImageTimeout,
		maxBodyBytes:   resolved.MaxBodyBytes,
		jinaBaseURL:    resolved.JinaBaseURL,
		userAgent:      resolved.UserAgent,
		browserFetch:   resolved.BrowserFetch,
	}
}

func applyConfigDefaults(cfg Config) Config {
	resolved := cfg
	if resolved.FeedTimeout <= 0 {
		resolved.FeedTimeout = defaultFeedTimeout
	}

	if resolved.WebpageTimeout <= 0 {
		resolved.WebpageTimeout = defaultWebpageTimeout
	}

	if resolved.ImageTimeout <= 0 {
		resolved.ImageTimeout = defaultImageTimeout
	}

	if resolved.MaxBodyBytes <= 0 {
		resolved.MaxBodyBytes = defaultMaxBodyBytes
	}

	resolved.JinaBaseURL = strings.TrimSpace(resolved.JinaBaseURL)
	if resolved.JinaBaseURL == "" {
		resolved.JinaBaseURL = defaultJinaBaseURL
	}

	if !strings.HasSuffix(resolved.JinaBaseURL, "/") {
		resolved.JinaBaseURL += "/"
	}

	resolved.UserAgent = strings.TrimSpace(resolved.UserAgent)
	if resolved.UserAgent == "" {
		resolved.UserAgent = defaultUserAgent
	}

	if resolved.BrowserFetch == nil {
		resolved.BrowserFetch = defaultBrowserFetch(resolved.MaxBodyBytes)
	}

	return resolved
}

func (c *Client) FetchFeed(ctx context.Context, target domain.NormalizedURL) (body []byte, finalURL string, err error) {
	req, err := newRequest(ctx, target)
	if err != nil {
		return nil, "", domain.NewError(domain.ErrFetchFeedError, err)
	}

	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept", feedAccept)

	result, err := c.do(ctx, req, c.feedTimeout)
	if err != nil {
		return nil, "", domain.NewError(domain.ErrFetchFeedError, sanitizedError(err))
	}

	if result.status < http.StatusOK || result.status > 299 {
		return nil, "", domain.NewError(domain.ErrFetchFeedError, fmt.Errorf("unexpected status code %d", result.status))
	}

	return result.body, sanitizedURL(result.finalURL), nil
}

func (c *Client) FetchWebpage(ctx context.Context, target domain.NormalizedURL) (htmlBody string, finalURL string, err error) {
	settings := domain.Settings{Provider: domain.ProviderDirect}
	if c.settings != nil {
		loaded, loadErr := c.settings.Get(ctx)
		if loadErr != nil {
			return "", "", domain.NewError(domain.ErrWebpageFetcherError, sanitizedError(loadErr))
		}

		settings = loaded
	}

	switch settings.Provider {
	case domain.ProviderJina:
		return c.fetchWithJina(ctx, target, settings)
	case domain.ProviderBrowser:
		return c.fetchWithBrowser(ctx, target, settings)
	default:
		return c.fetchDirect(ctx, target)
	}
}

func (c *Client) FetchImage(ctx context.Context, rawURL string) (data []byte, mediaType string, ext string, err error) {
	target, err := domain.ParseNormalizedURL(rawURL, domain.ErrInvalidPageUrl)
	if err != nil {
		return nil, "", "", err
	}

	req, err := newRequest(ctx, target)
	if err != nil {
		return nil, "", "", err
	}

	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept", imageAccept)

	result, err := c.do(ctx, req, c.imageTimeout)
	if err != nil {
		return nil, "", "", sanitizedError(err)
	}

	if result.status < http.StatusOK || result.status > 299 {
		return nil, "", "", fmt.Errorf("unexpected status code %d", result.status)
	}

	if len(result.body) == 0 {
		return nil, "", "", errEmptyResponseBody
	}

	detected, ext, ok := detectImageType(result.body)
	if !ok {
		return nil, "", "", errUnsupportedImage
	}

	return result.body, detected, ext, nil
}

func (c *Client) fetchDirect(ctx context.Context, target domain.NormalizedURL) (htmlBody string, finalURL string, err error) {
	req, reqErr := newRequest(ctx, target)
	if reqErr != nil {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, reqErr)
	}

	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept", webpageAccept)

	result, doErr := c.do(ctx, req, c.webpageTimeout)
	if doErr != nil {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, sanitizedError(doErr))
	}

	if result.status < http.StatusOK || result.status > 299 {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, fmt.Errorf("unexpected status code %d", result.status))
	}

	return string(result.body), sanitizedURL(result.finalURL), nil
}

func (c *Client) fetchWithJina(ctx context.Context, target domain.NormalizedURL, settings domain.Settings) (htmlBody string, finalURL string, err error) {
	if target.HasCredentials() {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, errExternalCredentials)
	}

	endpoint := c.jinaBaseURL + target.RedactedString()
	req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if reqErr != nil {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, sanitizedError(reqErr))
	}

	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept", jinaAccept)
	req.Header.Set("X-Respond-With", "html")

	if settings.JinaKey != nil {
		if key := strings.TrimSpace(*settings.JinaKey); key != "" {
			req.Header.Set("Authorization", "Bearer "+key)
		}
	}

	result, doErr := c.do(ctx, req, c.webpageTimeout)
	if doErr != nil {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, sanitizedError(doErr))
	}

	if result.status < http.StatusOK || result.status > 299 {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, fmt.Errorf("unexpected status code %d", result.status))
	}

	if len(result.body) == 0 {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, errEmptyResponseBody)
	}

	return string(result.body), target.RedactedString(), nil
}

func (c *Client) fetchWithBrowser(ctx context.Context, target domain.NormalizedURL, settings domain.Settings) (htmlBody string, finalURL string, err error) {
	if target.HasCredentials() {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, errExternalCredentials)
	}

	if settings.BrowserEndpoint == nil || strings.TrimSpace(*settings.BrowserEndpoint) == "" {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, errBrowserEndpointUnset)
	}

	endpoint, validateErr := domain.ValidateBrowserEndpoint(*settings.BrowserEndpoint)
	if validateErr != nil {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, errBrowserEndpointBad)
	}

	if c.browserFetch == nil {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, errBrowserEndpointUnset)
	}

	body, pageURL, fetchErr := c.browserFetch(ctx, endpoint, target.RedactedString(), c.webpageTimeout)
	if fetchErr != nil {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, sanitizeBrowserError(fetchErr, endpoint))
	}

	if int64(len(body)) > c.maxBodyBytes {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, errResponseTooLarge)
	}

	if strings.TrimSpace(pageURL) == "" {
		pageURL = target.RedactedString()
	}

	return body, sanitizedStringURL(pageURL), nil
}

func (c *Client) do(ctx context.Context, req *http.Request, timeout time.Duration) (*fetchResult, error) {
	requestCtx := ctx
	cancel := func() {}
	if timeout > 0 {
		requestCtx, cancel = context.WithTimeout(ctx, timeout)
	}

	defer cancel()

	resp, err := c.httpClient.Do(req.WithContext(requestCtx))
	if err != nil {
		return nil, sanitizedError(err)
	}

	defer func() { _ = resp.Body.Close() }()

	body, err := readLimitedBody(resp.Body, c.maxBodyBytes)
	if err != nil {
		return nil, sanitizedError(err)
	}

	return &fetchResult{status: resp.StatusCode, body: body, finalURL: resp.Request.URL}, nil
}

func newRequest(ctx context.Context, target domain.NormalizedURL) (*http.Request, error) {
	if strings.TrimSpace(target.Raw()) == "" {
		return nil, errEmptyURL
	}

	parsed, err := target.Parsed()
	if err != nil {
		return nil, sanitizedError(err)
	}

	requestURL := *parsed
	requestURL.User = nil

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return nil, sanitizedError(err)
	}

	if username, password, ok := target.BasicAuth(); ok {
		req.SetBasicAuth(username, password)
	}

	return req, nil
}

func detectImageType(data []byte) (mediaType string, ext string, ok bool) {
	detected := http.DetectContentType(data)
	if idx := strings.IndexByte(detected, ';'); idx >= 0 {
		detected = detected[:idx]
	}

	switch strings.TrimSpace(strings.ToLower(detected)) {
	case "image/jpeg":
		return "image/jpeg", ".jpg", true
	case "image/png":
		return "image/png", ".png", true
	case "image/gif":
		return "image/gif", ".gif", true
	default:
		return "", "", false
	}
}

func defaultBrowserFetch(maxBodyBytes int64) BrowserFetchFunc {
	return func(ctx context.Context, endpoint string, targetURL string, timeout time.Duration) (string, string, error) {
		return runBrowserFetch(ctx, endpoint, targetURL, timeout, maxBodyBytes)
	}
}

func runBrowserFetch(
	ctx context.Context,
	endpoint string,
	targetURL string,
	timeout time.Duration,
	maxBodyBytes int64,
) (string, string, error) {
	if timeout <= 0 {
		timeout = defaultWebpageTimeout
	}

	allocCtx, allocCancel := remote.NewAllocator(ctx, endpoint, remote.WithDialTimeout(timeout))
	defer allocCancel()

	tabCtx, tabCancel := chromedp.NewContext(allocCtx)
	defer tabCancel()

	runCtx, runCancel := context.WithTimeout(tabCtx, timeout)
	defer runCancel()

	err := chromedp.Do(runCtx, chromedp.Navigate(targetURL), chromedp.WaitReady(chromedp.CSS("body")))
	if err != nil {
		return "", "", fmt.Errorf("browser navigation failed: %w", err)
	}

	finalURL, err := chromedp.Run(runCtx, chromedp.Location())
	if err != nil {
		return "", "", fmt.Errorf("browser location failed: %w", err)
	}

	htmlBody, err := captureBrowserSnapshot(runCtx, maxBodyBytes)
	if err != nil {
		return "", "", err
	}

	return htmlBody, finalURL, nil
}

func captureBrowserSnapshot(ctx context.Context, maxBodyBytes int64) (string, error) {
	contextID, err := createSnapshotWorld(ctx)
	if err != nil {
		return "", err
	}

	snapshot, err := chromedp.Run(
		ctx,
		chromedp.Evaluate[browserSnapshot](
			fmt.Sprintf(browserHTMLScript, maxBodyBytes),
			func(params *runtime.EvaluateParams) {
				params.ContextID = contextID
			},
		),
	)
	if err != nil {
		return "", fmt.Errorf("browser html failed: %w", err)
	}

	if snapshot.TooLarge || int64(len(snapshot.HTML)) > maxBodyBytes {
		return "", errResponseTooLarge
	}

	return snapshot.HTML, nil
}

func createSnapshotWorld(ctx context.Context) (runtime.ExecutionContextID, error) {
	frameTree, err := chromedp.Call(ctx, page.GetFrameTree, cdp.Empty{})
	if err != nil {
		return 0, fmt.Errorf("browser frame tree failed: %w", err)
	}

	if frameTree.FrameTree == nil || frameTree.FrameTree.Frame == nil {
		return 0, errBrowserFetchFailed
	}

	world, err := chromedp.Call(
		ctx,
		page.CreateIsolatedWorld,
		page.CreateIsolatedWorldParams{
			FrameID:   frameTree.FrameTree.Frame.ID,
			WorldName: "liubai-snapshot",
		},
	)
	if err != nil {
		return 0, fmt.Errorf("browser isolated world failed: %w", err)
	}

	return world.ExecutionContextID, nil
}

func sanitizedError(err error) error {
	if err == nil {
		return nil
	}

	message := stripCredentialText(err.Error())
	if message == err.Error() {
		return err
	}

	return errors.New(message)
}

func sanitizeBrowserError(err error, endpoint string) error {
	if err == nil {
		return nil
	}

	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}

	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}

	if errors.Is(err, errResponseTooLarge) {
		return errResponseTooLarge
	}

	_ = endpoint

	return errBrowserFetchFailed
}

func stripCredentialText(message string) string {
	return userInfoPattern.ReplaceAllString(domain.SanitizeErrorText(message), "$1")
}

func sanitizedStringURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return stripCredentialText(raw)
	}

	return sanitizedURL(parsed)
}
