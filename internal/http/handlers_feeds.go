package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"reader/internal/domain"
)

const maxPreviewTitles = 3

type feedJSON struct {
	ID           string            `json:"id"`
	URL          string            `json:"url"`
	Title        string            `json:"title"`
	FolderID     *string           `json:"folderId,omitempty"`
	UpdatedAt    *string           `json:"updatedAt,omitempty"`
	FailureCount int               `json:"failureCount"`
	LastError    *string           `json:"lastError,omitempty"`
	ReaderMode   domain.ReaderMode `json:"readerMode"`
	Order        domain.SortOrder  `json:"order"`
}

func toFeedJSON(feed domain.Feed) feedJSON {
	return feedJSON{
		ID:           feed.ID,
		URL:          feed.URL.RedactedString(),
		Title:        feed.Title,
		FolderID:     feed.FolderID,
		UpdatedAt:    formatTimestampPtr(feed.UpdatedAt),
		FailureCount: feed.FailureCount,
		LastError:    feed.LastError,
		ReaderMode:   feed.ReaderMode,
		Order:        feed.Order,
	}
}

type feedItemJSON struct {
	ID               string  `json:"id"`
	FeedID           string  `json:"feedId"`
	URL              string  `json:"url"`
	Title            string  `json:"title"`
	Description      *string `json:"description,omitempty"`
	Content          *string `json:"content,omitempty"`
	ExtractedContent *string `json:"extractedContent,omitempty"`
	PublishedAt      *string `json:"publishedAt,omitempty"`
	Read             bool    `json:"read"`
}

func toFeedItemJSON(item domain.FeedItem) feedItemJSON {
	return feedItemJSON{
		ID:               item.ID,
		FeedID:           item.FeedID,
		URL:              item.URL.RedactedString(),
		Title:            item.Title,
		Description:      item.Description,
		Content:          item.Content,
		ExtractedContent: item.ExtractedContent,
		PublishedAt:      formatTimestampPtr(item.PublishedAt),
		Read:             item.Read,
	}
}

func toFeedItemsPage(result domain.PageResult[domain.FeedItem]) pageResponse[feedItemJSON] {
	return pageResponse[feedItemJSON]{
		Items:  mapSlice(result.Items, toFeedItemJSON),
		Cursor: result.Cursor,
	}
}

type feedUnreadCountJSON struct {
	FeedID string `json:"feedId"`
	Count  int    `json:"count"`
}

type feedPreviewJSON struct {
	URL         string   `json:"url"`
	Title       string   `json:"title"`
	Description *string  `json:"description,omitempty"`
	Titles      []string `json:"titles"`
}

type feedPreviewResponse struct {
	Preview feedPreviewJSON `json:"preview"`
}

type feedRequest struct {
	URL string `json:"url"`
}

type feedSubscribeRequest struct {
	URL      string  `json:"url"`
	Title    *string `json:"title"`
	FolderID *string `json:"folderId"`
}

type feedReadModeRequest struct {
	ReaderMode domain.ReaderMode `json:"readerMode"`
}

type feedOrderRequest struct {
	Order domain.SortOrder `json:"order"`
}

func (s *server) handleFeedList(w http.ResponseWriter, r *http.Request) {
	feeds, err := s.cfg.Feeds.List(r.Context())
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusOK, listResponse[feedJSON]{Items: mapSlice(feeds, toFeedJSON)})
}

func (s *server) handleFeedPreview(w http.ResponseWriter, r *http.Request) {
	var req feedRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	preview, err := s.fetchFeedPreview(r.Context(), req.URL)
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusOK, feedPreviewResponse{Preview: preview})
}

func (s *server) fetchFeedPreview(ctx context.Context, rawURL string) (feedPreviewJSON, error) {
	feedURL, err := domain.ParseNormalizedURL(rawURL, domain.ErrFeedUrlInvalid)
	if err != nil {
		return feedPreviewJSON{}, err
	}

	parsed, err := s.fetchAndParseFeed(ctx, feedURL)
	if err != nil {
		return feedPreviewJSON{}, err
	}

	titles := make([]string, 0, maxPreviewTitles)
	for _, entry := range parsed.Entries {
		if len(titles) == maxPreviewTitles {
			break
		}

		titles = append(titles, entry.Title)
	}

	title := strings.TrimSpace(parsed.Title)
	if title == "" {
		title = feedURL.Host()
	}

	return feedPreviewJSON{
		URL:         feedURL.RedactedString(),
		Title:       title,
		Description: parsed.Description,
		Titles:      titles,
	}, nil
}

func (s *server) fetchAndParseFeed(ctx context.Context, feedURL domain.NormalizedURL) (domain.ParsedFeed, error) {
	if !s.fetchSem.tryAcquire() {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrTooManyRequests, nil)
	}

	defer s.fetchSem.release()

	fetchCtx, cancel := s.withForegroundFetchTimeout(ctx)
	defer cancel()

	body, finalURL, err := s.cfg.FeedFetcher.FetchFeed(fetchCtx, feedURL)
	if err != nil {
		return domain.ParsedFeed{}, err
	}

	return s.cfg.FeedParser.ParseFeed(body, finalURL)
}

func (s *server) handleFeedSubscribe(w http.ResponseWriter, r *http.Request) {
	var req feedSubscribeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	feedURL, err := domain.ParseNormalizedURL(req.URL, domain.ErrFeedUrlInvalid)
	if err != nil {
		writeError(w, err)

		return
	}

	folderID, err := normalizeFolderID(req.FolderID)
	if err != nil {
		writeError(w, err)

		return
	}

	created, err := s.createFeedSubscription(r.Context(), feedURL, req.Title, folderID)
	if err != nil {
		writeError(w, err)

		return
	}

	converted := toFeedJSON(created)

	writeJSON(w, http.StatusCreated, itemResponse[feedJSON]{Item: &converted})
}

func (s *server) createFeedSubscription(ctx context.Context, feedURL domain.NormalizedURL, rawTitle *string, folderID *string) (domain.Feed, error) {
	title := feedURL.Host()
	if rawTitle != nil && strings.TrimSpace(*rawTitle) != "" {
		title = strings.TrimSpace(*rawTitle)
	}

	created, err := s.cfg.Feeds.Create(ctx, domain.Feed{
		ID:         domain.NewID(),
		URL:        feedURL,
		Title:      title,
		FolderID:   folderID,
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
	})
	if err != nil {
		return domain.Feed{}, err
	}

	if s.cfg.Refresher != nil {
		s.cfg.Refresher.Enqueue(created.ID)
	}

	return created, nil
}

func (s *server) handleFeedDelete(w http.ResponseWriter, r *http.Request) {
	if err := s.cfg.Feeds.Delete(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFeedRefresh(w http.ResponseWriter, r *http.Request) {
	feed, err := s.cfg.Feeds.GetByID(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)

		return
	}

	if feed != nil && s.cfg.Refresher != nil {
		s.cfg.Refresher.Enqueue(feed.ID)
	}

	w.WriteHeader(http.StatusAccepted)
}

func (s *server) handleFeedReaderMode(w http.ResponseWriter, r *http.Request) {
	var req feedReadModeRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	if err := domain.ValidateReaderMode(req.ReaderMode); err != nil {
		writeError(w, err)

		return
	}

	if err := s.cfg.Feeds.UpdateReaderMode(r.Context(), r.PathValue("id"), req.ReaderMode); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFeedOrder(w http.ResponseWriter, r *http.Request) {
	var req feedOrderRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	if err := domain.ValidateSortOrder(req.Order); err != nil {
		writeError(w, err)

		return
	}

	if err := s.cfg.Feeds.UpdateOrder(r.Context(), r.PathValue("id"), req.Order); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFeedMove(w http.ResponseWriter, r *http.Request) {
	// Decode the raw object so a missing "folderId" stays distinguishable from an
	// explicit null that moves the feed back to the top level.
	var raw map[string]json.RawMessage
	if err := decodeJSON(w, r, &raw); err != nil {
		writeError(w, err)

		return
	}

	value, present := raw["folderId"]
	if !present {
		writeError(w, domain.NewError(domain.ErrRequestFailed, nil))

		return
	}

	var rawFolderID *string
	if err := json.Unmarshal(value, &rawFolderID); err != nil {
		writeError(w, domain.NewError(domain.ErrRequestFailed, err))

		return
	}

	folderID, err := normalizeFolderID(rawFolderID)
	if err != nil {
		writeError(w, err)

		return
	}

	if err := s.cfg.Feeds.MoveToFolder(r.Context(), r.PathValue("id"), folderID); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func normalizeFolderID(raw *string) (*string, error) {
	if raw == nil {
		return nil, nil
	}

	trimmed := strings.TrimSpace(*raw)
	if trimmed == "" {
		return nil, domain.NewError(domain.ErrFolderNotFound, nil)
	}

	return &trimmed, nil
}

func (s *server) handleFeedUnreadCounts(w http.ResponseWriter, r *http.Request) {
	counts, err := s.cfg.FeedItems.UnreadCounts(r.Context())
	if err != nil {
		writeError(w, err)

		return
	}

	converted := mapSlice(counts, func(count domain.FeedUnreadCount) feedUnreadCountJSON {
		return feedUnreadCountJSON{FeedID: count.FeedID, Count: count.Count}
	})

	writeJSON(w, http.StatusOK, listResponse[feedUnreadCountJSON]{Items: converted})
}

func (s *server) handleFeedMarkRead(w http.ResponseWriter, r *http.Request) {
	if err := s.cfg.FeedItems.MarkFeedRead(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFeedItems(w http.ResponseWriter, r *http.Request) {
	query, err := parsePageQuery(r)
	if err != nil {
		writeError(w, err)

		return
	}

	order := domain.SortOrderNewest
	if query.hasOrder {
		order = query.order
	} else {
		feed, err := s.cfg.Feeds.GetByID(r.Context(), r.PathValue("id"))
		if err != nil {
			writeError(w, err)

			return
		}

		if feed != nil {
			order = feed.Order
		}
	}

	params, err := query.params(order)
	if err != nil {
		writeError(w, err)

		return
	}

	result, err := s.cfg.FeedItems.ListByFeed(r.Context(), r.PathValue("id"), params)
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusOK, toFeedItemsPage(result))
}

func (s *server) handleFeedItemList(w http.ResponseWriter, r *http.Request) {
	params, err := parseDefaultPageParams(r)
	if err != nil {
		writeError(w, err)

		return
	}

	result, err := s.cfg.FeedItems.ListAll(r.Context(), params)
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusOK, toFeedItemsPage(result))
}

func (s *server) handleFeedItemGet(w http.ResponseWriter, r *http.Request) {
	item, err := s.cfg.FeedItems.GetByID(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusOK, itemResponse[feedItemJSON]{Item: toPtr(item, toFeedItemJSON)})
}

func (s *server) handleFeedItemExtract(w http.ResponseWriter, r *http.Request) {
	item, err := s.cfg.FeedItems.GetByID(r.Context(), r.PathValue("id"))
	if err == nil && item == nil {
		err = domain.NewError(domain.ErrFeedItemNotFound, nil)
	}

	if err != nil {
		writeError(w, err)

		return
	}

	extracted := *item
	if !hasText(item.ExtractedContent) {
		updated, err := s.extracts.do(r.Context(), item.ID, func(ctx context.Context) (*domain.FeedItem, error) {
			return s.extractFeedItem(ctx, item.ID)
		})
		if err != nil {
			writeError(w, err)

			return
		}

		extracted = *updated
	}

	converted := toFeedItemJSON(extracted)

	writeJSON(w, http.StatusOK, itemResponse[feedItemJSON]{Item: &converted})
}

func (s *server) extractFeedItem(ctx context.Context, itemID string) (*domain.FeedItem, error) {
	latest, err := s.cfg.FeedItems.GetByID(ctx, itemID)
	if err != nil {
		return nil, err
	}

	if latest == nil {
		return nil, domain.NewError(domain.ErrFeedItemNotFound, nil)
	}

	if hasText(latest.ExtractedContent) {
		return latest, nil
	}

	article, err := s.extractWebpageWithSlot(ctx, latest.URL)
	if err != nil {
		return nil, err
	}

	if err := ctx.Err(); err != nil {
		return nil, err
	}

	updated, _, err := s.cfg.FeedItems.SaveExtractedContentIfEmpty(ctx, latest.ID, article.Content)
	if err != nil {
		return nil, err
	}

	if updated == nil {
		return nil, domain.NewError(domain.ErrFeedItemNotFound, nil)
	}

	return updated, nil
}

type extractCall struct {
	done    chan struct{}
	cancel  context.CancelFunc
	waiters int
	item    *domain.FeedItem
	err     error
}

type extractGroup struct {
	mu         sync.Mutex
	closed     bool
	active     sync.WaitGroup
	drained    chan struct{}
	calls      map[string]*extractCall
	inflight   map[*extractCall]struct{}
	sem        slotSemaphore
	timeout    time.Duration
	beforeJoin func(key string)
}

func newExtractGroup(sem slotSemaphore, timeout time.Duration) *extractGroup {
	return &extractGroup{
		calls:    make(map[string]*extractCall),
		inflight: make(map[*extractCall]struct{}),
		sem:      sem,
		timeout:  timeout,
	}
}

func (g *extractGroup) do(ctx context.Context, key string, fn func(context.Context) (*domain.FeedItem, error)) (*domain.FeedItem, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	if g.beforeJoin != nil {
		g.beforeJoin(key)
	}

	call, err := g.joinOrStart(ctx, key, fn)
	if err != nil {
		return nil, err
	}

	select {
	case <-call.done:
		return call.item, call.err
	case <-ctx.Done():
		g.abandon(key, call)

		return nil, ctx.Err()
	}
}

func (g *extractGroup) joinOrStart(ctx context.Context, key string, fn func(context.Context) (*domain.FeedItem, error)) (*extractCall, error) {
	g.mu.Lock()
	if g.closed {
		g.mu.Unlock()

		return nil, domain.NewError(domain.ErrTooManyRequests, nil)
	}

	if call, ok := g.calls[key]; ok {
		call.waiters++
		g.mu.Unlock()

		return call, nil
	}

	if !g.sem.tryAcquire() {
		g.mu.Unlock()

		return nil, domain.NewError(domain.ErrTooManyRequests, nil)
	}

	callCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), g.timeout)
	call := &extractCall{done: make(chan struct{}), cancel: cancel, waiters: 1}
	g.calls[key] = call
	g.inflight[call] = struct{}{}
	g.active.Add(1)
	g.mu.Unlock()

	go g.run(callCtx, key, call, fn)

	return call, nil
}

func (g *extractGroup) run(callCtx context.Context, key string, call *extractCall, fn func(context.Context) (*domain.FeedItem, error)) {
	defer g.active.Done()

	item, err := runContained(callCtx, fn)
	call.cancel()
	g.sem.release()

	g.mu.Lock()
	call.item = item
	call.err = err
	delete(g.inflight, call)
	if g.calls[key] == call {
		delete(g.calls, key)
	}

	close(call.done)
	g.mu.Unlock()
}

func runContained(ctx context.Context, fn func(context.Context) (*domain.FeedItem, error)) (item *domain.FeedItem, err error) {
	defer func() {
		if recover() != nil {
			item, err = nil, errors.New("feed item extraction panicked")
		}
	}()

	return fn(ctx)
}

func (g *extractGroup) abandon(key string, call *extractCall) {
	g.mu.Lock()
	call.waiters--
	shouldCancel := call.waiters == 0
	if shouldCancel && g.calls[key] == call {
		delete(g.calls, key)
	}

	g.mu.Unlock()

	if shouldCancel {
		call.cancel()
	}
}

type listResponse[T any] struct {
	Items []T `json:"items"`
}
