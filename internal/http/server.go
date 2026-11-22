// Package httpserver serves the reader JSON API, authentication, and the
// embedded single-page app.
package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"reader/internal/domain"
)

const (
	maxRequestBodyBytes = 10 << 20

	immutableCacheControl = "public, max-age=31536000, immutable"
	indexCacheControl     = "no-cache"
)

// FeedRefresher schedules background refreshes without exposing the worker
// implementation to the HTTP layer.
type FeedRefresher interface {
	Enqueue(feedIDs ...string)
}

// KindleDispatcher starts manual Send-to-Kindle jobs and reports whether a job
// is already running.
type KindleDispatcher interface {
	IsRunning() bool
	EnqueueManual(ctx context.Context) (domain.KindleSendRecord, error)
}

// Config carries the settings, repositories, adapters, and workers the HTTP
// layer needs.
type Config struct {
	AppPassword   string
	AppURL        string
	SessionSecret []byte
	Location      *time.Location
	Now           func() time.Time
	HealthCheck   func(ctx context.Context) error
	StaticFS      fs.FS

	Folders     domain.FolderRepository
	Feeds       domain.FeedRepository
	FeedItems   domain.FeedItemRepository
	SavedPages  domain.SavedPageRepository
	Settings    domain.SettingRepository
	KindleSends domain.KindleSendRepository

	FeedFetcher      domain.FeedFetcher
	FeedParser       domain.FeedParser
	WebpageFetcher   domain.WebpageFetcher
	ArticleExtractor domain.ArticleExtractor

	Refresher FeedRefresher
	Kindle    KindleDispatcher
}

type server struct {
	cfg     Config
	appURL  *url.URL
	secure  bool
	limiter *loginLimiter
	mux     *http.ServeMux
}

// NewServer validates the static configuration and wires the route table.
func NewServer(cfg Config) (http.Handler, error) {
	if cfg.Now == nil {
		cfg.Now = time.Now
	}

	if cfg.Location == nil {
		cfg.Location = time.UTC
	}

	if len(cfg.SessionSecret) == 0 {
		return nil, errors.New("http: session secret is required")
	}

	appURL, err := url.Parse(strings.TrimSpace(cfg.AppURL))
	if err != nil {
		// The raw URL may embed credentials, so never echo it or the parse error.
		return nil, errors.New("http: invalid APP_URL")
	}

	if appURL.Scheme == "" || appURL.Host == "" || appURL.User != nil {
		return nil, errors.New("http: invalid APP_URL")
	}

	s := &server{
		cfg:     cfg,
		appURL:  appURL,
		secure:  strings.EqualFold(appURL.Scheme, "https"),
		limiter: newLoginLimiter(cfg.Now),
	}

	s.mux = s.routes()

	return s, nil
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if isAPIPath(r.URL.Path) {
		if isStateChanging(r.Method) && !s.originAllowed(r) {
			writeError(w, domain.NewError(domain.ErrForbidden, nil))

			return
		}

		if !isPublicAPIRoute(r.Method, r.URL.Path) && !s.hasValidSession(r) {
			writeError(w, domain.NewError(domain.ErrUnauthorized, nil))

			return
		}
	}

	s.mux.ServeHTTP(w, r)
}

func (s *server) routes() *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", s.handleHealthz)

	mux.HandleFunc("GET /api/auth/session", s.handleSession)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)

	s.registerSavedPageRoutes(mux)
	s.registerFeedRoutes(mux)
	s.registerFolderAndSettingRoutes(mux)

	mux.HandleFunc("/api", s.handleAPINotFound)
	mux.HandleFunc("/api/", s.handleAPINotFound)
	mux.HandleFunc("/", s.handleStatic)

	return mux
}

func (s *server) registerSavedPageRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/saved-pages", s.handleSavedPageList)
	mux.HandleFunc("POST /api/saved-pages", s.handleSavedPageCreate)
	mux.HandleFunc("GET /api/saved-pages/unread-count", s.handleSavedPageUnreadCount)
	mux.HandleFunc("GET /api/saved-pages/lookup", s.handleSavedPageLookup)
	mux.HandleFunc("POST /api/saved-pages/read", s.handleSavedPagesMarkRead)
	mux.HandleFunc("POST /api/saved-pages/read-all", s.handleSavedPagesMarkAllRead)
	mux.HandleFunc("GET /api/saved-pages/{id}", s.handleSavedPageGet)
	mux.HandleFunc("PATCH /api/saved-pages/{id}", s.handleSavedPageSetRead)
	mux.HandleFunc("DELETE /api/saved-pages/{id}", s.handleSavedPageDelete)
}

func (s *server) registerFeedRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/feeds", s.handleFeedList)
	mux.HandleFunc("POST /api/feeds", s.handleFeedSubscribe)
	mux.HandleFunc("POST /api/feeds/preview", s.handleFeedPreview)
	mux.HandleFunc("GET /api/feeds/unread-counts", s.handleFeedUnreadCounts)
	mux.HandleFunc("GET /api/feeds/{id}/items", s.handleFeedItems)
	mux.HandleFunc("POST /api/feeds/{id}/refresh", s.handleFeedRefresh)
	mux.HandleFunc("PUT /api/feeds/{id}/reader-mode", s.handleFeedReaderMode)
	mux.HandleFunc("PUT /api/feeds/{id}/order", s.handleFeedOrder)
	mux.HandleFunc("PATCH /api/feeds/{id}", s.handleFeedMove)
	mux.HandleFunc("DELETE /api/feeds/{id}", s.handleFeedDelete)
	mux.HandleFunc("POST /api/feeds/{id}/read-all", s.handleFeedMarkRead)

	mux.HandleFunc("GET /api/feed-items", s.handleFeedItemList)
	mux.HandleFunc("POST /api/feed-items/read", s.handleFeedItemsMarkRead)
	mux.HandleFunc("POST /api/feed-items/read-all", s.handleFeedItemsMarkAllRead)
	mux.HandleFunc("GET /api/feed-items/{id}", s.handleFeedItemGet)
	mux.HandleFunc("PATCH /api/feed-items/{id}", s.handleFeedItemSetRead)
	mux.HandleFunc("POST /api/feed-items/{id}/save", s.handleFeedItemSave)
	mux.HandleFunc("POST /api/feed-items/{id}/extract", s.handleFeedItemExtract)

	mux.HandleFunc("GET /api/opml", s.handleOPMLExport)
	mux.HandleFunc("POST /api/opml", s.handleOPMLImport)
}

func (s *server) registerFolderAndSettingRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/folders", s.handleFolderList)
	mux.HandleFunc("POST /api/folders", s.handleFolderCreate)
	mux.HandleFunc("PATCH /api/folders/{id}", s.handleFolderRename)
	mux.HandleFunc("DELETE /api/folders/{id}", s.handleFolderDelete)
	mux.HandleFunc("POST /api/folders/{id}/read-all", s.handleFolderMarkRead)
	mux.HandleFunc("GET /api/folders/{id}/items", s.handleFolderItems)

	mux.HandleFunc("GET /api/settings", s.handleSettingsGet)
	mux.HandleFunc("PUT /api/settings/retention", s.handleRetentionUpdate)
	mux.HandleFunc("PUT /api/settings/provider", s.handleProviderUpdate)
	mux.HandleFunc("PUT /api/settings/services/jina", s.handleJinaKeySave)
	mux.HandleFunc("DELETE /api/settings/services/jina", s.handleJinaKeyDelete)
	mux.HandleFunc("PUT /api/settings/services/browser", s.handleBrowserEndpointSave)
	mux.HandleFunc("DELETE /api/settings/services/browser", s.handleBrowserEndpointDelete)
	mux.HandleFunc("PUT /api/settings/services/smtp", s.handleSMTPSave)
	mux.HandleFunc("DELETE /api/settings/services/smtp", s.handleSMTPDelete)
	mux.HandleFunc("DELETE /api/settings/services/smtp/password", s.handleSMTPPasswordDelete)
	mux.HandleFunc("PUT /api/settings/kindle", s.handleKindleSettingsUpdate)

	mux.HandleFunc("POST /api/kindle/send", s.handleKindleSend)
	mux.HandleFunc("GET /api/kindle/sends", s.handleKindleSends)
}

func (s *server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	if s.cfg.HealthCheck != nil {
		if err := s.cfg.HealthCheck(r.Context()); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, statusResponse{Status: "error"})

			return
		}
	}

	writeJSON(w, http.StatusOK, statusResponse{Status: "ok"})
}

func (s *server) handleAPINotFound(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusNotFound, errorResponse{Error: string(domain.ErrRequestFailed)})
}

func (s *server) handleStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)

		return
	}

	if s.cfg.StaticFS == nil {
		http.NotFound(w, r)

		return
	}

	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" || !hasFileExtension(name) {
		s.serveIndex(w, r)

		return
	}

	info, err := fs.Stat(s.cfg.StaticFS, name)
	if err != nil || info.IsDir() {
		http.NotFound(w, r)

		return
	}

	if strings.HasPrefix(name, "assets/") {
		w.Header().Set("Cache-Control", immutableCacheControl)
	}

	http.ServeFileFS(w, r, s.cfg.StaticFS, name)
}

func (s *server) serveIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", indexCacheControl)
	http.ServeFileFS(w, r, s.cfg.StaticFS, "index.html")
}

func hasFileExtension(name string) bool {
	return path.Ext(name) != ""
}

func (s *server) extractWebpage(ctx context.Context, pageURL domain.NormalizedURL) (domain.ExtractedArticle, error) {
	htmlBody, finalURL, err := s.cfg.WebpageFetcher.FetchWebpage(ctx, pageURL)
	if err != nil {
		return domain.ExtractedArticle{}, err
	}

	return s.cfg.ArticleExtractor.ExtractArticle(htmlBody, finalURL)
}

type statusResponse struct {
	Status string `json:"status"`
}

type errorResponse struct {
	Error string `json:"error"`
	URL   string `json:"url,omitempty"`
}

type itemResponse[T any] struct {
	Item *T `json:"item"`
}

type pageResponse[T any] struct {
	Items  []T     `json:"items"`
	Cursor *string `json:"cursor"`
}

type pageQuery struct {
	limit    int
	hasLimit bool
	unread   bool
	hasOrder bool
	order    domain.SortOrder
	cursor   *string
}

func parsePageQuery(r *http.Request) (pageQuery, error) {
	values := r.URL.Query()
	parsed := pageQuery{}

	if values.Has("limit") {
		limit, err := strconv.Atoi(strings.TrimSpace(values.Get("limit")))
		if err != nil {
			return pageQuery{}, domain.NewError(domain.ErrRequestFailed, err)
		}

		parsed.limit = limit
		parsed.hasLimit = true
	}

	unread, err := parseUnreadFlag(values)
	if err != nil {
		return pageQuery{}, err
	}

	parsed.unread = unread

	if queryOrder := strings.TrimSpace(values.Get("order")); queryOrder != "" {
		parsed.hasOrder = true
		parsed.order = domain.SortOrder(strings.ToLower(queryOrder))
	}

	if cursor := strings.TrimSpace(values.Get("cursor")); cursor != "" {
		parsed.cursor = &cursor
	}

	return parsed, nil
}

func parseUnreadFlag(values url.Values) (bool, error) {
	if !values.Has("unread") {
		return false, nil
	}

	switch strings.ToLower(strings.TrimSpace(values.Get("unread"))) {
	case "", "true", "1":
		return true, nil
	case "false", "0":
		return false, nil
	default:
		return false, domain.NewError(domain.ErrRequestFailed, nil)
	}
}

func (q pageQuery) params(order domain.SortOrder) (domain.PageParams, error) {
	return domain.ValidatePageParams(q.limit, q.hasLimit, q.unread, order, q.cursor)
}

func isAPIPath(requestPath string) bool {
	return requestPath == "/api" || strings.HasPrefix(requestPath, "/api/")
}

func isStateChanging(method string) bool {
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
		return true
	default:
		return false
	}
}

func isPublicAPIRoute(method string, requestPath string) bool {
	if method == http.MethodGet && requestPath == "/api/auth/session" {
		return true
	}

	return method == http.MethodPost && (requestPath == "/api/auth/login" || requestPath == "/api/auth/logout")
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)

	_ = json.NewEncoder(w).Encode(payload)
}

func writeNoContent(w http.ResponseWriter) {
	w.WriteHeader(http.StatusNoContent)
}

func writeError(w http.ResponseWriter, err error) {
	code := domain.ErrRequestFailed
	status := http.StatusInternalServerError
	redactedURL := ""

	var domainErr *domain.DomainError
	if errors.As(err, &domainErr) {
		code = domainErr.Code
		status = statusForCode(code)
		redactedURL = domainErr.URL
	}

	writeJSON(w, status, errorResponse{Error: string(code), URL: redactedURL})
}

func statusForCode(code domain.ErrorCode) int {
	switch code {
	case domain.ErrInvalidPageUrl,
		domain.ErrFeedUrlInvalid,
		domain.ErrInvalidOpml,
		domain.ErrInvalidFolderName,
		domain.ErrInvalidRetention,
		domain.ErrInvalidProvider,
		domain.ErrInvalidJinaKey,
		domain.ErrInvalidEndpoint,
		domain.ErrInvalidSMTPSetting,
		domain.ErrInvalidKindleSetting,
		domain.ErrRequestFailed:
		return http.StatusBadRequest
	case domain.ErrUnauthorized, domain.ErrInvalidCredentials:
		return http.StatusUnauthorized
	case domain.ErrForbidden:
		return http.StatusForbidden
	case domain.ErrFeedItemNotFound, domain.ErrFolderNotFound:
		return http.StatusNotFound
	case domain.ErrSavedPageAlreadyExists,
		domain.ErrFeedAlreadyExists,
		domain.ErrFolderAlreadyExists,
		domain.ErrKindleSendInProgress:
		return http.StatusConflict
	case domain.ErrArticleEmptyContent,
		domain.ErrWebpageFetcherError,
		domain.ErrArticleExtractorError,
		domain.ErrFetchFeedError,
		domain.ErrFeedParserError,
		domain.ErrBrowserEndpointRequired,
		domain.ErrSMTPNotConfigured,
		domain.ErrKindleNotConfigured:
		return http.StatusUnprocessableEntity
	case domain.ErrTooManyRequests:
		return http.StatusTooManyRequests
	default:
		return http.StatusInternalServerError
	}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)

	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		return domain.NewError(domain.ErrRequestFailed, err)
	}

	// Reject a second JSON value so `{"read":true}{"read":false}` cannot smuggle
	// ambiguous trailing payloads past validation.
	var trailing any
	if err := dec.Decode(&trailing); !errors.Is(err, io.EOF) {
		return domain.NewError(domain.ErrRequestFailed, nil)
	}

	return nil
}

func trimOptional(value *string) *string {
	if value == nil {
		return nil
	}

	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}

	return &trimmed
}

func formatTimestamp(value time.Time) string {
	return value.UTC().Format(time.RFC3339)
}

func formatTimestampPtr(value *time.Time) *string {
	if value == nil {
		return nil
	}

	formatted := formatTimestamp(*value)

	return &formatted
}
