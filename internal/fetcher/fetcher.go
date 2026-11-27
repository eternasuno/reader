package fetcher

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"reader/internal/domain"
)

const (
	defaultFeedTimeout        = 15 * time.Second
	defaultWebpageTimeout     = 20 * time.Second
	defaultImageTimeout       = 15 * time.Second
	defaultBrowserlessTimeout = 45 * time.Second
	defaultMaxBodyBytes       = 10 * 1024 * 1024
	defaultUserAgent          = "LanternReader/1.0"

	browserlessDeadlineMargin = 3 * time.Second
	browserlessTimeoutMargin  = 2 * time.Second
	browserlessMinBudget      = 8 * time.Second
	browserlessUnblockPath    = "unblock"
	browserlessProxyValue     = "residential"
	jsonMediaType             = "application/json"

	feedAccept    = "application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*"
	webpageAccept = "text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8"
	imageAccept   = "image/jpeg, image/png, image/gif, image/*;q=0.8, */*;q=0.1"
)

var (
	errExternalCredentials   = errors.New("refusing to forward credentialed url to external provider")
	errEmptyResponseBody     = errors.New("empty response body")
	errUnsupportedImage      = errors.New("unsupported image media type")
	errBrowserlessBudget     = errors.New("not enough time left for a browserless request")
	errBrowserlessEndpoint   = errors.New("browserless endpoint is invalid")
	errBrowserlessBadPayload = errors.New("browserless response is not valid")
	errBrowserlessTransport  = errors.New("browserless request failed")
)

type browserlessUnblockRequest struct {
	URL               string `json:"url"`
	Content           bool   `json:"content"`
	Cookies           bool   `json:"cookies"`
	Screenshot        bool   `json:"screenshot"`
	BrowserWSEndpoint bool   `json:"browserWSEndpoint"`
}

type browserlessUnblockResponse struct {
	Content string `json:"content"`
}

type Config struct {
	AllowPrivateNetwork bool
	FeedTimeout         time.Duration
	WebpageTimeout      time.Duration
	ImageTimeout        time.Duration
	BrowserlessTimeout  time.Duration
	MaxBodyBytes        int64
}

type Client struct {
	httpClient         *http.Client
	browserlessClient  *http.Client
	feedTimeout        time.Duration
	webpageTimeout     time.Duration
	imageTimeout       time.Duration
	browserlessTimeout time.Duration
	maxBodyBytes       int64
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
		httpClient:         newHTTPClient(resolved.AllowPrivateNetwork),
		browserlessClient:  newBrowserlessClient(),
		feedTimeout:        resolved.FeedTimeout,
		webpageTimeout:     resolved.WebpageTimeout,
		imageTimeout:       resolved.ImageTimeout,
		browserlessTimeout: resolved.BrowserlessTimeout,
		maxBodyBytes:       resolved.MaxBodyBytes,
	}
}

func applyConfigDefaults(cfg Config) Config {
	resolved := cfg
	resolved.FeedTimeout = cmp.Or(resolved.FeedTimeout, defaultFeedTimeout)
	resolved.WebpageTimeout = cmp.Or(resolved.WebpageTimeout, defaultWebpageTimeout)
	resolved.ImageTimeout = cmp.Or(resolved.ImageTimeout, defaultImageTimeout)
	resolved.BrowserlessTimeout = cmp.Or(resolved.BrowserlessTimeout, defaultBrowserlessTimeout)
	resolved.MaxBodyBytes = cmp.Or(resolved.MaxBodyBytes, defaultMaxBodyBytes)

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

func (c *Client) FetchDirect(ctx context.Context, target domain.NormalizedURL) (htmlBody string, finalURL string, err error) {
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

func (c *Client) FetchBrowserless(
	ctx context.Context,
	target domain.NormalizedURL,
	service domain.BrowserlessSettings,
) (htmlBody string, finalURL string, err error) {
	if target.HasCredentials() {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, errExternalCredentials)
	}

	budget, ok := c.browserlessBudget(ctx)
	if !ok {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, errBrowserlessBudget)
	}

	content, reqErr := c.requestBrowserless(ctx, target, service, budget)
	if reqErr != nil {
		return "", "", domain.NewError(domain.ErrWebpageFetcherError, reqErr)
	}

	return content, target.RedactedString(), nil
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

func (c *Client) browserlessBudget(ctx context.Context) (time.Duration, bool) {
	budget := c.browserlessTimeout
	if deadline, ok := ctx.Deadline(); ok {
		budget = min(budget, time.Until(deadline)-browserlessDeadlineMargin)
	}

	return budget, budget >= browserlessMinBudget
}

func (c *Client) requestBrowserless(
	ctx context.Context,
	target domain.NormalizedURL,
	service domain.BrowserlessSettings,
	budget time.Duration,
) (string, error) {
	requestCtx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()

	req, err := newBrowserlessRequest(requestCtx, target, service, budget)
	if err != nil {
		return "", err
	}

	resp, err := c.browserlessClient.Do(req)
	if err != nil {
		return "", browserlessCause(err)
	}

	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < http.StatusOK || resp.StatusCode > 299 {
		return "", fmt.Errorf("unexpected status code %d", resp.StatusCode)
	}

	return c.readBrowserlessContent(resp.Body)
}

func (c *Client) readBrowserlessContent(body io.Reader) (string, error) {
	data, err := readLimitedBody(body, 2*c.maxBodyBytes)
	if errors.Is(err, errResponseTooLarge) {
		return "", errResponseTooLarge
	}

	if err != nil {
		return "", browserlessCause(err)
	}

	var payload browserlessUnblockResponse
	if err = json.Unmarshal(data, &payload); err != nil {
		return "", errBrowserlessBadPayload
	}

	if payload.Content == "" {
		return "", errEmptyResponseBody
	}

	if int64(len(payload.Content)) > c.maxBodyBytes {
		return "", errResponseTooLarge
	}

	return payload.Content, nil
}

func newBrowserlessRequest(
	ctx context.Context,
	target domain.NormalizedURL,
	service domain.BrowserlessSettings,
	budget time.Duration,
) (*http.Request, error) {
	endpoint, err := browserlessEndpoint(service, budget)
	if err != nil {
		return nil, err
	}

	payload, err := json.Marshal(browserlessUnblockRequest{URL: target.RedactedString(), Content: true})
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, browserlessCause(err)
	}

	req.Header.Set("Content-Type", jsonMediaType)
	req.Header.Set("Accept", jsonMediaType)

	return req, nil
}

func browserlessEndpoint(service domain.BrowserlessSettings, budget time.Duration) (string, error) {
	base, err := url.Parse(service.URL)
	if err != nil || base.Hostname() == "" {
		return "", errBrowserlessEndpoint
	}

	query := url.Values{}
	query.Set("timeout", strconv.FormatInt((budget-browserlessTimeoutMargin).Milliseconds(), 10))

	if service.Token != nil {
		query.Set("token", *service.Token)
	}

	if service.ResidentialProxy {
		query.Set("proxy", browserlessProxyValue)
	}

	endpoint := base.JoinPath(browserlessUnblockPath)
	endpoint.RawQuery = query.Encode()

	return endpoint.String(), nil
}

func browserlessCause(err error) error {
	switch {
	case errors.Is(err, context.Canceled):
		return context.Canceled
	case errors.Is(err, context.DeadlineExceeded):
		return context.DeadlineExceeded
	default:
		return errBrowserlessTransport
	}
}

func (c *Client) executeHTTP(
	ctx context.Context,
	req *http.Request,
	accept string,
	timeout time.Duration,
) (*fetchResult, error) {
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req.Header.Set("User-Agent", defaultUserAgent)
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

type sanitizedMessageError struct {
	message string
	cause   error
}

func (e *sanitizedMessageError) Error() string {
	return e.message
}

func (e *sanitizedMessageError) Unwrap() error {
	return e.cause
}

func sanitizedError(err error) error {
	if err == nil {
		return nil
	}

	message := domain.SanitizeErrorText(err.Error())
	if message == err.Error() {
		return err
	}

	return &sanitizedMessageError{message: message, cause: err}
}
