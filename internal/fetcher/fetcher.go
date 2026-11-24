package fetcher

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
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
	defaultFeedTimeout       = 15 * time.Second
	defaultWebpageTimeout    = 20 * time.Second
	defaultImageTimeout      = 15 * time.Second
	defaultMaxBodyBytes      = 10 * 1024 * 1024
	defaultJinaBaseURL       = "https://r.jina.ai/"
	defaultUserAgent         = "LanternReader/1.0"
	browserDiscoveryMaxBytes = 64 * 1024
	browserDiscoveryPath     = "/json/version"

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
)

type browserSnapshot struct {
	HTML     string `json:"html"`
	TooLarge bool   `json:"tooLarge"`
}

type browserVersionResponse struct {
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
}

// ExtractorSettings carries the narrow subset of settings that webpage
// fetching needs.
type ExtractorSettings struct {
	Provider        domain.ExtractorProvider
	JinaKey         *string
	BrowserEndpoint *string
}

// SettingsQuery reads the current webpage extractor settings dynamically on
// each extraction.
type SettingsQuery func(ctx context.Context) (ExtractorSettings, error)

type BrowserFetchFunc func(ctx context.Context, endpoint string, targetURL string, timeout time.Duration) (htmlBody string, finalURL string, err error)

type hostLookupFunc func(ctx context.Context, host string) ([]net.IPAddr, error)

type Config struct {
	AllowPrivateNetwork bool
	Settings            SettingsQuery
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
	settings       SettingsQuery
	feedTimeout    time.Duration
	webpageTimeout time.Duration
	imageTimeout   time.Duration
	maxBodyBytes   int64
	jinaBaseURL    string
	userAgent      string
	browserFetch   BrowserFetchFunc
}

type fetchResult struct {
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

	result, err := c.executeHTTP(ctx, req, feedAccept, c.feedTimeout)
	if err != nil {
		return nil, "", domain.NewError(domain.ErrFetchFeedError, err)
	}

	return result.body, sanitizedURL(result.finalURL), nil
}

func (c *Client) FetchWebpage(ctx context.Context, target domain.NormalizedURL) (htmlBody string, finalURL string, err error) {
	settings := ExtractorSettings{Provider: domain.ProviderDirect}
	if c.settings != nil {
		loaded, loadErr := c.settings(ctx)
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

	result, err := c.executeHTTP(ctx, req, imageAccept, c.imageTimeout)
	if err != nil {
		return nil, "", "", err
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

	result, doErr := c.executeHTTP(ctx, req, webpageAccept, c.webpageTimeout)
	if doErr != nil {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, doErr)
	}

	return string(result.body), sanitizedURL(result.finalURL), nil
}

func (c *Client) fetchWithJina(ctx context.Context, target domain.NormalizedURL, settings ExtractorSettings) (htmlBody string, finalURL string, err error) {
	if target.HasCredentials() {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, errExternalCredentials)
	}

	endpoint := c.jinaBaseURL + target.RedactedString()
	req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if reqErr != nil {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, sanitizedError(reqErr))
	}

	req.Header.Set("X-Respond-With", "html")

	if settings.JinaKey != nil {
		if key := strings.TrimSpace(*settings.JinaKey); key != "" {
			req.Header.Set("Authorization", "Bearer "+key)
		}
	}

	result, doErr := c.executeHTTP(ctx, req, jinaAccept, c.webpageTimeout)
	if doErr != nil {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, doErr)
	}

	if len(result.body) == 0 {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, errEmptyResponseBody)
	}

	return string(result.body), target.RedactedString(), nil
}

func (c *Client) fetchWithBrowser(ctx context.Context, target domain.NormalizedURL, settings ExtractorSettings) (htmlBody string, finalURL string, err error) {
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

	body, pageURL, fetchErr := c.browserFetch(ctx, endpoint, target.RedactedString(), c.webpageTimeout)
	if fetchErr != nil {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, classifyBrowserError(fetchErr))
	}

	if int64(len(body)) > c.maxBodyBytes {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, errResponseTooLarge)
	}

	if strings.TrimSpace(pageURL) == "" {
		pageURL = target.RedactedString()
	}

	return body, sanitizedStringURL(pageURL), nil
}

func (c *Client) executeHTTP(
	ctx context.Context,
	req *http.Request,
	accept string,
	timeout time.Duration,
) (*fetchResult, error) {
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req.Header.Set("User-Agent", c.userAgent)
	req.Header.Set("Accept", accept)

	resp, err := c.httpClient.Do(req.WithContext(requestCtx))
	if err != nil {
		return nil, sanitizedError(err)
	}

	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < http.StatusOK || resp.StatusCode > 299 {
		return nil, fmt.Errorf("unexpected status code %d", resp.StatusCode)
	}

	body, err := readLimitedBody(resp.Body, c.maxBodyBytes)
	if err != nil {
		return nil, sanitizedError(err)
	}

	return &fetchResult{body: body, finalURL: resp.Request.URL}, nil
}

func newRequest(ctx context.Context, target domain.NormalizedURL) (*http.Request, error) {
	if strings.TrimSpace(target.Raw()) == "" {
		return nil, errEmptyURL
	}

	parsed, err := target.Parsed()
	if err != nil {
		return nil, sanitizedError(err)
	}

	req, err := newGETRequestFromURL(ctx, parsed)
	if err != nil {
		return nil, sanitizedError(err)
	}

	return req, nil
}

func newGETRequestFromURL(ctx context.Context, parsed *url.URL) (*http.Request, error) {
	requestURL := *parsed
	requestURL.User = nil

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return nil, err
	}

	if parsed.User != nil {
		password, hasPassword := parsed.User.Password()
		if parsed.User.Username() != "" || hasPassword {
			req.SetBasicAuth(parsed.User.Username(), password)
		}
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
	wsURL, err := resolveBrowserEndpoint(ctx, endpoint, timeout)
	if err != nil {
		return "", "", classifyBrowserError(err)
	}

	allocCtx, allocCancel := remote.NewAllocator(ctx, wsURL, remote.NoModifyURL, remote.WithDialTimeout(timeout))
	defer allocCancel()

	tabCtx, tabCancel := chromedp.NewContext(allocCtx, chromedp.WithNewBrowserContext())
	defer tabCancel()

	runCtx, runCancel := context.WithTimeout(tabCtx, timeout)
	defer runCancel()

	if err := chromedp.Do(runCtx, chromedp.Navigate(targetURL), chromedp.WaitReady(chromedp.CSS("body"))); err != nil {
		return "", "", classifyBrowserError(err)
	}

	finalURL, err := chromedp.Run(runCtx, chromedp.Location())
	if err != nil {
		return "", "", classifyBrowserError(err)
	}

	htmlBody, err := captureBrowserSnapshot(runCtx, maxBodyBytes)
	if err != nil {
		return "", "", classifyBrowserError(err)
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
		return "", err
	}

	if snapshot.TooLarge || int64(len(snapshot.HTML)) > maxBodyBytes {
		return "", errResponseTooLarge
	}

	return snapshot.HTML, nil
}

func createSnapshotWorld(ctx context.Context) (runtime.ExecutionContextID, error) {
	frameTree, err := chromedp.Call(ctx, page.GetFrameTree, cdp.Empty{})
	if err != nil {
		return 0, err
	}

	if frameTree.FrameTree == nil || frameTree.FrameTree.Frame == nil {
		return 0, errBrowserFetchFailed
	}

	world, err := chromedp.Call(
		ctx,
		page.CreateIsolatedWorld,
		page.CreateIsolatedWorldParams{
			FrameID:   frameTree.FrameTree.Frame.ID,
			WorldName: "lantern-snapshot",
		},
	)
	if err != nil {
		return 0, err
	}

	return world.ExecutionContextID, nil
}

func sanitizedError(err error) error {
	if err == nil {
		return nil
	}

	message := domain.SanitizeErrorText(err.Error())
	if message == err.Error() {
		return err
	}

	return errors.New(message)
}

func classifyBrowserError(err error) error {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return context.DeadlineExceeded
	case errors.Is(err, context.Canceled):
		return context.Canceled
	case errors.Is(err, errResponseTooLarge):
		return errResponseTooLarge
	default:
		return errBrowserFetchFailed
	}
}

func resolveBrowserEndpoint(ctx context.Context, endpoint string, timeout time.Duration) (string, error) {
	httpClient := newBrowserDiscoveryClient()
	defer httpClient.CloseIdleConnections()

	return resolveBrowserWSURL(ctx, httpClient, net.DefaultResolver.LookupIPAddr, endpoint, timeout)
}

func resolveBrowserWSURL(
	ctx context.Context,
	httpClient *http.Client,
	lookupIP hostLookupFunc,
	endpoint string,
	timeout time.Duration,
) (string, error) {
	parsed, scheme, err := parseBrowserEndpoint(endpoint)
	if err != nil {
		return "", err
	}

	if timeout <= 0 {
		timeout = defaultWebpageTimeout
	}

	resolveCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	resolvedHost, resolved, err := resolvePlaintextEndpointHost(resolveCtx, lookupIP, parsed, scheme)
	if err != nil {
		return "", err
	}

	if scheme == "ws" || scheme == "wss" {
		parsed.Scheme = scheme

		return parsed.String(), nil
	}

	return discoverResolvedBrowserWSURL(resolveCtx, httpClient, parsed.String(), resolvedHost, resolved)
}

func discoverResolvedBrowserWSURL(
	ctx context.Context,
	httpClient *http.Client,
	endpoint string,
	resolvedHost string,
	resolved bool,
) (string, error) {
	discoveryURL, err := browserDiscoveryURL(endpoint)
	if err != nil {
		return "", err
	}

	wsURL, err := discoverBrowserWSURL(ctx, httpClient, discoveryURL)
	if err != nil {
		return "", err
	}

	if !resolved {
		return wsURL, nil
	}

	return rewriteBrowserWSURLHost(wsURL, resolvedHost)
}

func parseBrowserEndpoint(endpoint string) (*url.URL, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || parsed.Hostname() == "" {
		return nil, "", errBrowserEndpointBad
	}

	scheme := strings.ToLower(parsed.Scheme)
	switch scheme {
	case "http", "https", "ws", "wss":
		return parsed, scheme, nil
	default:
		return nil, "", errBrowserEndpointBad
	}
}

func resolvePlaintextEndpointHost(
	ctx context.Context,
	lookupIP hostLookupFunc,
	parsed *url.URL,
	scheme string,
) (string, bool, error) {
	if scheme != "http" && scheme != "ws" {
		return "", false, nil
	}

	hostname := parsed.Hostname()
	if isIPLiteralOrLocalhost(hostname) {
		return "", false, nil
	}

	ip, err := resolveBrowserHost(ctx, lookupIP, hostname)
	if err != nil {
		return "", false, err
	}

	replaceURLHost(parsed, ip)

	return parsed.Host, true, nil
}

func isIPLiteralOrLocalhost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}

	_, err := netip.ParseAddr(host)

	return err == nil
}

func resolveBrowserHost(ctx context.Context, lookupIP hostLookupFunc, host string) (string, error) {
	if lookupIP == nil {
		lookupIP = net.DefaultResolver.LookupIPAddr
	}

	addrs, err := lookupIP(ctx, host)
	if err != nil {
		return "", classifyBrowserError(err)
	}

	ip, ok := selectPreferredIP(addrs)
	if !ok {
		return "", errBrowserFetchFailed
	}

	return ip, nil
}

func selectPreferredIP(addrs []net.IPAddr) (string, bool) {
	for _, addr := range addrs {
		if ip4 := addr.IP.To4(); ip4 != nil {
			return ip4.String(), true
		}
	}

	for _, addr := range addrs {
		if len(addr.IP) > 0 && addr.IP.To16() != nil {
			return addr.IP.String(), true
		}
	}

	return "", false
}

func replaceURLHost(parsed *url.URL, ip string) {
	port := parsed.Port()
	if port != "" {
		parsed.Host = net.JoinHostPort(ip, port)

		return
	}

	if addr, err := netip.ParseAddr(ip); err == nil && addr.Is6() {
		parsed.Host = "[" + addr.String() + "]"

		return
	}

	parsed.Host = ip
}

func rewriteBrowserWSURLHost(wsURL string, host string) (string, error) {
	parsed, err := url.Parse(wsURL)
	if err != nil || parsed.Hostname() == "" {
		return "", errBrowserFetchFailed
	}

	if parsed.Scheme != "ws" {
		return wsURL, nil
	}

	parsed.Host = host

	return parsed.String(), nil
}

func browserDiscoveryURL(endpoint string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || parsed.Hostname() == "" {
		return "", errBrowserEndpointBad
	}

	switch strings.ToLower(parsed.Scheme) {
	case "http", "ws":
		parsed.Scheme = "http"
	case "https", "wss":
		parsed.Scheme = "https"
	default:
		return "", errBrowserEndpointBad
	}

	parsed.Path = browserDiscoveryPath
	parsed.RawPath = ""
	parsed.Fragment = ""
	parsed.RawFragment = ""

	return parsed.String(), nil
}

func discoverBrowserWSURL(
	ctx context.Context,
	httpClient *http.Client,
	discoveryURL string,
) (string, error) {
	if httpClient == nil {
		return "", errBrowserFetchFailed
	}

	req, err := newBrowserDiscoveryRequest(ctx, discoveryURL)
	if err != nil {
		return "", err
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", classifyBrowserError(err)
	}

	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < http.StatusOK || resp.StatusCode > 299 {
		return "", errBrowserFetchFailed
	}

	body, err := readLimitedBody(resp.Body, browserDiscoveryMaxBytes)
	if err != nil {
		return "", classifyBrowserError(err)
	}

	return parseBrowserDiscoveryResponse(body)
}

func newBrowserDiscoveryRequest(ctx context.Context, discoveryURL string) (*http.Request, error) {
	parsedURL, err := url.Parse(discoveryURL)
	if err != nil {
		return nil, errBrowserEndpointBad
	}

	req, err := newGETRequestFromURL(ctx, parsedURL)
	if err != nil {
		return nil, errBrowserFetchFailed
	}

	return req, nil
}

func parseBrowserDiscoveryResponse(body []byte) (string, error) {
	var payload browserVersionResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", errBrowserFetchFailed
	}

	trimmed := strings.TrimSpace(payload.WebSocketDebuggerURL)
	if trimmed == "" {
		return "", errBrowserFetchFailed
	}

	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Hostname() == "" {
		return "", errBrowserFetchFailed
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "ws" && scheme != "wss" {
		return "", errBrowserFetchFailed
	}

	parsed.Scheme = scheme

	return parsed.String(), nil
}

func sanitizedStringURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return domain.SanitizeErrorText(raw)
	}

	return sanitizedURL(parsed)
}
