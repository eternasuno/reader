package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"

	"reader/internal/domain"
)

const (
	opmlContentType    = "text/x-opml+xml; charset=utf-8"
	opmlFilename       = "subscriptions.opml"
	maxOPMLUploadBytes = 10 << 20
	maxPreviewTitles   = 3
)

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

func toFeedsJSON(feeds []domain.Feed) []feedJSON {
	converted := make([]feedJSON, 0, len(feeds))
	for _, feed := range feeds {
		converted = append(converted, toFeedJSON(feed))
	}

	return converted
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

func toFeedItemPtr(item *domain.FeedItem) *feedItemJSON {
	if item == nil {
		return nil
	}

	converted := toFeedItemJSON(*item)

	return &converted
}

func toFeedItemsPage(result domain.PageResult[domain.FeedItem]) pageResponse[feedItemJSON] {
	items := make([]feedItemJSON, 0, len(result.Items))
	for _, item := range result.Items {
		items = append(items, toFeedItemJSON(item))
	}

	return pageResponse[feedItemJSON]{Items: items, Cursor: result.Cursor}
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

type opmlImportResponse struct {
	ImportedFeeds  int `json:"importedFeeds"`
	SkippedFeeds   int `json:"skippedFeeds"`
	CreatedFolders int `json:"createdFolders"`
}

func (s *server) handleFeedList(w http.ResponseWriter, r *http.Request) {
	feeds, err := s.cfg.Feeds.List(r.Context())
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusOK, listResponse[feedJSON]{Items: toFeedsJSON(feeds)})
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

	body, finalURL, err := s.cfg.FeedFetcher.FetchFeed(ctx, feedURL)
	if err != nil {
		return feedPreviewJSON{}, err
	}

	parsed, err := s.cfg.FeedParser.ParseFeed(body, finalURL)
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

	title := feedURL.Host()
	if req.Title != nil && strings.TrimSpace(*req.Title) != "" {
		title = strings.TrimSpace(*req.Title)
	}

	created, err := s.cfg.Feeds.Create(r.Context(), domain.Feed{
		ID:         domain.NewID(),
		URL:        feedURL,
		Title:      title,
		FolderID:   trimOptional(req.FolderID),
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
	})
	if err != nil {
		writeError(w, err)

		return
	}

	if s.cfg.Refresher != nil {
		s.cfg.Refresher.Enqueue(created.ID)
	}

	writeJSON(w, http.StatusCreated, itemResponse[feedJSON]{Item: toFeedPtr(&created)})
}

func toFeedPtr(feed *domain.Feed) *feedJSON {
	if feed == nil {
		return nil
	}

	converted := toFeedJSON(*feed)

	return &converted
}

func (s *server) handleFeedDelete(w http.ResponseWriter, r *http.Request) {
	if err := s.cfg.Feeds.Delete(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFeedRefresh(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Refresher != nil {
		s.cfg.Refresher.Enqueue(r.PathValue("id"))
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

	var folderID *string
	if err := json.Unmarshal(value, &folderID); err != nil {
		writeError(w, domain.NewError(domain.ErrRequestFailed, err))

		return
	}

	if err := s.cfg.Feeds.MoveToFolder(r.Context(), r.PathValue("id"), trimOptional(folderID)); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFeedUnreadCounts(w http.ResponseWriter, r *http.Request) {
	counts, err := s.cfg.FeedItems.UnreadCounts(r.Context())
	if err != nil {
		writeError(w, err)

		return
	}

	converted := make([]feedUnreadCountJSON, 0, len(counts))
	for _, count := range counts {
		converted = append(converted, feedUnreadCountJSON{FeedID: count.FeedID, Count: count.Count})
	}

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
	query, err := parsePageQuery(r)
	if err != nil {
		writeError(w, err)

		return
	}

	params, err := query.params(query.orderOrDefault())
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

	writeJSON(w, http.StatusOK, itemResponse[feedItemJSON]{Item: toFeedItemPtr(item)})
}

func (s *server) handleFeedItemSetRead(w http.ResponseWriter, r *http.Request) {
	var req readStateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	if req.Read == nil {
		writeError(w, domain.NewError(domain.ErrRequestFailed, nil))

		return
	}

	if err := s.cfg.FeedItems.SetRead(r.Context(), r.PathValue("id"), *req.Read); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFeedItemsMarkRead(w http.ResponseWriter, r *http.Request) {
	var req idsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	if err := s.cfg.FeedItems.MarkIDsRead(r.Context(), req.IDs); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFeedItemsMarkAllRead(w http.ResponseWriter, r *http.Request) {
	if err := s.cfg.FeedItems.MarkAllRead(r.Context()); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFeedItemExtract(w http.ResponseWriter, r *http.Request) {
	item, err := s.cfg.FeedItems.GetByID(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)

		return
	}

	if item == nil {
		writeError(w, domain.NewError(domain.ErrFeedItemNotFound, nil))

		return
	}

	if hasText(item.ExtractedContent) {
		writeJSON(w, http.StatusOK, itemResponse[feedItemJSON]{Item: toFeedItemPtr(item)})

		return
	}

	article, err := s.extractWebpage(r.Context(), item.URL)
	if err != nil {
		writeError(w, err)

		return
	}

	updated, err := s.cfg.FeedItems.SaveExtractedContent(r.Context(), item.ID, article.Content)
	if err != nil {
		writeError(w, err)

		return
	}

	if updated == nil {
		writeError(w, domain.NewError(domain.ErrFeedItemNotFound, nil))

		return
	}

	writeJSON(w, http.StatusOK, itemResponse[feedItemJSON]{Item: toFeedItemPtr(updated)})
}

func (s *server) handleOPMLExport(w http.ResponseWriter, r *http.Request) {
	folders, err := s.cfg.Folders.List(r.Context())
	if err != nil {
		writeError(w, err)

		return
	}

	feeds, err := s.cfg.Feeds.List(r.Context())
	if err != nil {
		writeError(w, err)

		return
	}

	exportFolders, topFeeds := groupFeedsForOPML(folders, feeds)

	payload, err := domain.ExportOPML(exportFolders, topFeeds)
	if err != nil {
		writeError(w, err)

		return
	}

	w.Header().Set("Content-Type", opmlContentType)
	w.Header().Set("Content-Disposition", `attachment; filename="`+opmlFilename+`"`)
	w.WriteHeader(http.StatusOK)

	_, _ = w.Write(payload)
}

func groupFeedsForOPML(folders []domain.Folder, feeds []domain.Feed) ([]domain.OPMLExportFolder, []domain.Feed) {
	grouped := make(map[string][]domain.Feed, len(folders))
	folderIndex := make(map[string]struct{}, len(folders))
	for _, folder := range folders {
		folderIndex[folder.ID] = struct{}{}
	}

	topFeeds := make([]domain.Feed, 0, len(feeds))
	for _, feed := range feeds {
		if feed.FolderID == nil {
			topFeeds = append(topFeeds, feed)

			continue
		}

		// A folder deleted between the two reads leaves the feed orphaned; export
		// it at the top level rather than silently dropping it.
		if _, ok := folderIndex[*feed.FolderID]; !ok {
			topFeeds = append(topFeeds, feed)

			continue
		}

		grouped[*feed.FolderID] = append(grouped[*feed.FolderID], feed)
	}

	exportFolders := make([]domain.OPMLExportFolder, 0, len(folders))
	for _, folder := range folders {
		exportFolders = append(exportFolders, domain.OPMLExportFolder{Name: folder.Name, Feeds: grouped[folder.ID]})
	}

	return exportFolders, topFeeds
}

func (s *server) handleOPMLImport(w http.ResponseWriter, r *http.Request) {
	payload, err := readOPMLUpload(w, r)
	if err != nil {
		writeError(w, err)

		return
	}

	document, err := domain.ParseOPML(payload)
	if err != nil {
		writeError(w, err)

		return
	}

	result, newFeedIDs, err := s.cfg.Feeds.ImportOPML(r.Context(), document)
	if err != nil {
		writeError(w, err)

		return
	}

	if s.cfg.Refresher != nil && len(newFeedIDs) > 0 {
		s.cfg.Refresher.Enqueue(newFeedIDs...)
	}

	writeJSON(w, http.StatusOK, opmlImportResponse{
		ImportedFeeds:  result.ImportedFeeds,
		SkippedFeeds:   result.SkippedFeeds,
		CreatedFolders: result.CreatedFolders,
	})
}

func readOPMLUpload(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err == nil && strings.HasPrefix(mediaType, "multipart/") {
		return readOPMLMultipart(w, r)
	}

	payload, err := io.ReadAll(io.LimitReader(r.Body, maxOPMLUploadBytes+1))
	if err != nil {
		return nil, domain.NewError(domain.ErrInvalidOpml, err)
	}

	if len(payload) > maxOPMLUploadBytes {
		return nil, domain.NewError(domain.ErrInvalidOpml, nil)
	}

	return payload, nil
}

func readOPMLMultipart(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxOPMLUploadBytes)

	if err := r.ParseMultipartForm(maxOPMLUploadBytes); err != nil {
		return nil, domain.NewError(domain.ErrInvalidOpml, err)
	}

	if file, _, err := r.FormFile("file"); err == nil {
		defer func() { _ = file.Close() }()

		return readLimited(file)
	}

	for _, headers := range r.MultipartForm.File {
		if len(headers) == 0 {
			continue
		}

		file, err := headers[0].Open()
		if err != nil {
			return nil, domain.NewError(domain.ErrInvalidOpml, err)
		}

		defer func() { _ = file.Close() }()

		return readLimited(file)
	}

	return nil, domain.NewError(domain.ErrInvalidOpml, errors.New("opml upload has no file part"))
}

func readLimited(r io.Reader) ([]byte, error) {
	payload, err := io.ReadAll(io.LimitReader(r, maxOPMLUploadBytes+1))
	if err != nil {
		return nil, domain.NewError(domain.ErrInvalidOpml, err)
	}

	if len(payload) > maxOPMLUploadBytes {
		return nil, domain.NewError(domain.ErrInvalidOpml, nil)
	}

	return payload, nil
}

type listResponse[T any] struct {
	Items []T `json:"items"`
}
