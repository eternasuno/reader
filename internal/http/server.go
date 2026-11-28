// Package httpserver serves the reader JSON API, authentication, and the
// embedded single-page app.
package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"path"
	"slices"
	"strings"
	"time"

	"reader/internal/domain"
)

const (
	maxRequestBodyBytes            = 10 << 20
	maxLoginBodyBytes              = 4 << 10
	maxConcurrentForegroundFetches = 4
	defaultForegroundFetchTimeout  = 55 * time.Second

	apiCacheControl       = "no-store"
	immutableCacheControl = "public, max-age=31536000, immutable"
	indexCacheControl     = "no-cache"
	indexReferrerPolicy   = "same-origin"
	indexCSP              = "default-src 'self'; " +
		"script-src 'self'; " +
		"style-src 'self' 'unsafe-inline'; " +
		"img-src 'self' https: http: data:; " +
		"media-src https: http:; " +
		"frame-src https: http:; " +
		"connect-src 'self'; " +
		"object-src 'none'; " +
		"base-uri 'none'; " +
		"form-action 'self'; " +
		"frame-ancestors 'none'"
)

// FeedRefresher wakes the background refresh workers after the HTTP layer has
// made feeds due, without exposing the worker implementation.
type FeedRefresher interface {
	Wake()
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
	AppPassword            string
	AppURL                 string
	SessionSecret          []byte
	Now                    func() time.Time
	ForegroundFetchTimeout time.Duration
	HealthCheck            func(ctx context.Context) error
	StaticFS               fs.FS

	Folders     domain.FolderRepository
	Feeds       domain.FeedRepository
	FeedItems   domain.FeedItemRepository
	SavedPages  domain.SavedPageRepository
	Settings    domain.SettingRepository
	KindleSends domain.KindleSendRepository

	FeedFetcher      domain.FeedFetcher
	FeedParser       domain.FeedParser
	WebpageExtractor domain.WebpageExtractor

	Refresher FeedRefresher
	Kindle    KindleDispatcher
}

var errExtractionsStillRunning = errors.New("extractions still running after cancellation grace")

type Server struct {
	cfg       Config
	appOrigin domain.Origin
	secure    bool
	limiter   *loginLimiter
	fetchSem  slotSemaphore
	extracts  *extractGroup
	mux       *http.ServeMux
}

type server = Server

// NewServer validates the static configuration and wires the route table.
func NewServer(cfg Config) (*Server, error) {
	if cfg.ForegroundFetchTimeout <= 0 {
		cfg.ForegroundFetchTimeout = defaultForegroundFetchTimeout
	}

	appOrigin, err := parseAppOrigin(cfg.AppURL)
	if err != nil {
		return nil, err
	}

	fetchSem := newSlotSemaphore(maxConcurrentForegroundFetches)
	s := &server{
		cfg:       cfg,
		appOrigin: appOrigin,
		secure:    appOrigin.Scheme == "https",
		limiter:   newLoginLimiter(cfg.Now),
		fetchSem:  fetchSem,
		extracts:  newExtractGroup(fetchSem, cfg.ForegroundFetchTimeout),
	}

	s.mux = s.routes()

	return s, nil
}

func (s *Server) WaitExtractions(ctx context.Context) error {
	drained := s.extracts.closeAndDrained()
	s.extracts.cancelInflight()

	select {
	case <-drained:
		return nil
	default:
	}

	select {
	case <-drained:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("%w: %w", errExtractionsStillRunning, ctx.Err())
	}
}

// ValidateAppURL checks that APP_URL is an http or https origin without credentials.
func ValidateAppURL(rawAppURL string) error {
	_, err := parseAppOrigin(rawAppURL)

	return err
}

func parseAppOrigin(rawAppURL string) (domain.Origin, error) {
	appURL, err := url.Parse(strings.TrimSpace(rawAppURL))
	if err != nil {
		// The raw URL may embed credentials, so never echo it or the parse error.
		return domain.Origin{}, errors.New("http: invalid APP_URL")
	}

	if appURL.User != nil || appURL.Host == "" || appURL.Opaque != "" || strings.HasSuffix(appURL.Host, ":") {
		return domain.Origin{}, errors.New("http: invalid APP_URL")
	}

	appOrigin, ok := domain.OriginFromURL(appURL)
	if !ok || (appOrigin.Scheme != "http" && appOrigin.Scheme != "https") {
		return domain.Origin{}, errors.New("http: invalid APP_URL")
	}

	return appOrigin, nil
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")

	if isAPIPath(r.URL.Path) {
		w.Header().Set("Cache-Control", apiCacheControl)

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
	mux.HandleFunc("GET /api/saved-pages", s.handleSavedPageBatch)
	mux.HandleFunc("GET /api/saved-pages/order", s.handleSavedPageSnapshot)
	mux.HandleFunc("POST /api/saved-pages", s.handleSavedPageCreate)
	mux.HandleFunc("GET /api/saved-pages/unread-count", s.handleSavedPageUnreadCount)
	mux.HandleFunc("POST /api/saved-pages/read", handleMarkIDsRead(s.cfg.SavedPages))
	mux.HandleFunc("POST /api/saved-pages/read-all", handleMarkAllRead(s.cfg.SavedPages))
	mux.HandleFunc("GET /api/saved-pages/{id}", s.handleSavedPageGet)
	mux.HandleFunc("PATCH /api/saved-pages/{id}", handleSetRead(s.cfg.SavedPages))
	mux.HandleFunc("DELETE /api/saved-pages/{id}", s.handleSavedPageDelete)
}

func (s *server) registerFeedRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/feeds", s.handleFeedList)
	mux.HandleFunc("POST /api/feeds", s.handleFeedSubscribe)
	mux.HandleFunc("POST /api/feeds/preview", s.handleFeedPreview)
	mux.HandleFunc("GET /api/feeds/unread-counts", s.handleFeedUnreadCounts)
	mux.HandleFunc("GET /api/feeds/{id}/items/order", s.handleFeedItemSnapshot)
	mux.HandleFunc("POST /api/feeds/{id}/refresh", s.handleFeedRefresh)
	mux.HandleFunc("PUT /api/feeds/{id}/reader-mode", s.handleFeedReaderMode)
	mux.HandleFunc("PUT /api/feeds/{id}/order", s.handleFeedOrder)
	mux.HandleFunc("PATCH /api/feeds/{id}", s.handleFeedMove)
	mux.HandleFunc("DELETE /api/feeds/{id}", s.handleFeedDelete)
	mux.HandleFunc("POST /api/feeds/{id}/read-all", s.handleFeedMarkRead)

	mux.HandleFunc("GET /api/feed-items", s.handleFeedItemBatch)
	mux.HandleFunc("GET /api/feed-items/order", s.handleAllFeedItemSnapshot)
	mux.HandleFunc("POST /api/feed-items/read", handleMarkIDsRead(s.cfg.FeedItems))
	mux.HandleFunc("POST /api/feed-items/read-all", handleMarkAllRead(s.cfg.FeedItems))
	mux.HandleFunc("GET /api/feed-items/{id}", s.handleFeedItemGet)
	mux.HandleFunc("PATCH /api/feed-items/{id}", handleSetRead(s.cfg.FeedItems))
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
	mux.HandleFunc("GET /api/folders/{id}/items/order", s.handleFolderItemSnapshot)

	mux.HandleFunc("GET /api/settings", s.handleSettingsGet)
	mux.HandleFunc("PUT /api/settings/retention", s.handleRetentionUpdate)
	mux.HandleFunc("PUT /api/settings/services/browserless", s.handleBrowserlessSave)
	mux.HandleFunc("DELETE /api/settings/services/browserless", s.handleBrowserlessDelete)
	mux.HandleFunc("DELETE /api/settings/services/browserless/token", s.handleBrowserlessTokenDelete)
	mux.HandleFunc("PUT /api/settings/services/smtp", s.handleSMTPSave)
	mux.HandleFunc("DELETE /api/settings/services/smtp", s.handleSMTPDelete)
	mux.HandleFunc("DELETE /api/settings/services/smtp/password", s.handleSMTPPasswordDelete)
	mux.HandleFunc("PUT /api/settings/kindle", s.handleKindleSettingsUpdate)

	mux.HandleFunc("POST /api/kindle/send", s.handleKindleSend)
	mux.HandleFunc("GET /api/kindle/sends", s.handleKindleSends)
}

func (s *server) handleHealthz(w http.ResponseWriter, r *http.Request) {
	if err := s.cfg.HealthCheck(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, statusResponse{Status: "error"})

		return
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

	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name == "" || name == "index.html" || path.Ext(name) == "" {
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
	} else {
		w.Header().Set("Cache-Control", indexCacheControl)
	}

	if path.Ext(name) == ".webmanifest" {
		w.Header().Set("Content-Type", "application/manifest+json")
	}

	http.ServeFileFS(w, r, s.cfg.StaticFS, name)
}

func (s *server) serveIndex(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", indexCacheControl)
	w.Header().Set("Content-Security-Policy", indexCSP)
	w.Header().Set("Referrer-Policy", indexReferrerPolicy)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeFileFS(w, r, s.cfg.StaticFS, "index.html")
}

type slotSemaphore chan struct{}

func newSlotSemaphore(capacity int) slotSemaphore {
	return make(slotSemaphore, capacity)
}

func (s slotSemaphore) tryAcquire() bool {
	select {
	case s <- struct{}{}:
		return true
	default:
		return false
	}
}

func (s slotSemaphore) release() {
	<-s
}

func (s *server) withForegroundFetchTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, s.cfg.ForegroundFetchTimeout)
}

func (s *server) extractWebpage(ctx context.Context, pageURL domain.NormalizedURL) (domain.ExtractedArticle, error) {
	if !s.fetchSem.tryAcquire() {
		return domain.ExtractedArticle{}, domain.NewError(domain.ErrTooManyRequests, nil)
	}

	defer s.fetchSem.release()

	fetchCtx, cancel := s.withForegroundFetchTimeout(ctx)
	defer cancel()

	return s.cfg.WebpageExtractor.ExtractWebpage(fetchCtx, pageURL)
}

type readStateRepository interface {
	SetRead(ctx context.Context, id string, read bool) error
	MarkIDsRead(ctx context.Context, ids []string) error
	MarkAllRead(ctx context.Context, boundary string) error
}

func handleSetRead(repo readStateRepository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req readStateRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeError(w, err)

			return
		}

		if req.Read == nil {
			writeError(w, domain.NewError(domain.ErrRequestFailed, nil))

			return
		}

		if err := repo.SetRead(r.Context(), r.PathValue("id"), *req.Read); err != nil {
			writeError(w, err)

			return
		}

		writeNoContent(w)
	}
}

func handleMarkIDsRead(repo readStateRepository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req idsRequest
		if err := decodeJSON(w, r, &req); err != nil {
			writeError(w, err)

			return
		}

		if req.IDs == nil {
			writeError(w, domain.NewError(domain.ErrRequestFailed, nil))

			return
		}

		if err := repo.MarkIDsRead(r.Context(), req.IDs); err != nil {
			writeError(w, err)

			return
		}

		writeNoContent(w)
	}
}

type readAllRequest struct {
	Before string `json:"before"`
}

func decodeReadAllBefore(w http.ResponseWriter, r *http.Request) (string, error) {
	var req readAllRequest
	if err := decodeStrictJSON(w, r, &req); err != nil {
		return "", err
	}

	if !domain.IsValidUUIDv7(req.Before) {
		return "", domain.NewError(domain.ErrRequestFailed, nil)
	}

	return req.Before, nil
}

func handleMarkAllRead(repo readStateRepository) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		before, err := decodeReadAllBefore(w, r)
		if err != nil {
			writeError(w, err)

			return
		}

		if err := repo.MarkAllRead(r.Context(), before); err != nil {
			writeError(w, err)

			return
		}

		writeNoContent(w)
	}
}

type statusResponse struct {
	Status string `json:"status"`
}

type errorResponse struct {
	Error string `json:"error"`
	ID    string `json:"id,omitempty"`
	URL   string `json:"url,omitempty"`
}

type itemResponse[T any] struct {
	Item *T `json:"item"`
}

func parseStrictQuery(r *http.Request, allowedKeys ...string) (url.Values, error) {
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return nil, domain.NewError(domain.ErrRequestFailed, err)
	}

	for key, entries := range values {
		if len(entries) != 1 || !slices.Contains(allowedKeys, key) {
			return nil, domain.NewError(domain.ErrRequestFailed, nil)
		}
	}

	return values, nil
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

func parseSnapshotParams(r *http.Request) (domain.SnapshotParams, error) {
	query, err := parseStrictQuery(r, "unread", "keep")
	if err != nil {
		return domain.SnapshotParams{}, err
	}

	unread, keep, err := parseSnapshotFilter(query)
	if err != nil {
		return domain.SnapshotParams{}, err
	}

	return domain.NewSnapshotParams(unread, keep), nil
}

// parseSnapshotFilter reads `unread` and `keep`, an id the unread filter must not drop; `keep`
// is only valid together with `unread`.
func parseSnapshotFilter(query url.Values) (bool, string, error) {
	unread, err := parseUnreadFlag(query)
	if err != nil {
		return false, "", err
	}

	if !query.Has("keep") {
		return unread, "", nil
	}

	keep := query.Get("keep")
	if !unread || !domain.IsValidUUIDv7(keep) {
		return false, "", domain.NewError(domain.ErrRequestFailed, nil)
	}

	return unread, keep, nil
}

func parseBatchIDs(r *http.Request) ([]string, error) {
	query, err := parseStrictQuery(r, "ids")
	if err != nil {
		return nil, err
	}

	var ids []string
	if query.Has("ids") {
		ids = strings.SplitN(query.Get("ids"), ",", domain.MaxBatchIDs+1)
	}

	if err := domain.ValidateBatchIDs(ids); err != nil {
		return nil, err
	}

	return ids, nil
}

func mapSlice[In, Out any](items []In, convert func(In) Out) []Out {
	converted := make([]Out, 0, len(items))
	for _, item := range items {
		converted = append(converted, convert(item))
	}

	return converted
}

func toPtr[In, Out any](item *In, convert func(In) Out) *Out {
	if item == nil {
		return nil
	}

	converted := convert(*item)

	return &converted
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
	conflictID := ""

	var domainErr *domain.DomainError
	if errors.As(err, &domainErr) {
		code = domainErr.Code
		status = statusForCode(code)
		redactedURL = domainErr.URL
		conflictID = domainErr.ID
	}

	if status >= http.StatusInternalServerError {
		logInternalError(code, err)
	}

	writeJSON(w, status, errorResponse{Error: string(code), ID: conflictID, URL: redactedURL})
}

func statusForCode(code domain.ErrorCode) int {
	switch code {
	case domain.ErrInvalidPageUrl,
		domain.ErrFeedUrlInvalid,
		domain.ErrInvalidOpml,
		domain.ErrInvalidFolderName,
		domain.ErrInvalidRetention,
		domain.ErrInvalidBrowserlessSetting,
		domain.ErrInvalidSMTPSetting,
		domain.ErrInvalidKindleSetting,
		domain.ErrSavedPageLimitExceeded,
		domain.ErrFeedItemBudgetExceeded,
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
	return decodeJSONWithLimit(w, r, maxRequestBodyBytes, dst)
}

func decodeStrictJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	return decodeJSONReader(w, r, maxRequestBodyBytes, dst, true)
}

func decodeJSONWithLimit(w http.ResponseWriter, r *http.Request, maxBytes int64, dst any) error {
	return decodeJSONReader(w, r, maxBytes, dst, false)
}

func decodeJSONReader(w http.ResponseWriter, r *http.Request, maxBytes int64, dst any, disallowUnknown bool) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)

	dec := json.NewDecoder(r.Body)
	if disallowUnknown {
		dec.DisallowUnknownFields()
	}

	if err := dec.Decode(dst); err != nil {
		return domain.NewError(domain.ErrRequestFailed, err)
	}

	// Reject a second JSON token so `{"read":true}{"read":false}` cannot smuggle
	// ambiguous trailing payloads without allocating an arbitrary value tree.
	if _, err := dec.Token(); !errors.Is(err, io.EOF) {
		return domain.NewError(domain.ErrRequestFailed, nil)
	}

	return nil
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
