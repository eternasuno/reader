package httpserver

import (
	"context"
	"net/http"
	"strings"

	"reader/internal/domain"
)

type savedPageJSON struct {
	ID          string  `json:"id"`
	URL         string  `json:"url"`
	Title       string  `json:"title"`
	Description *string `json:"description,omitempty"`
	Content     string  `json:"content"`
	PublishedAt *string `json:"publishedAt,omitempty"`
	Read        bool    `json:"read"`
}

func toSavedPageJSON(page domain.SavedPage) savedPageJSON {
	return savedPageJSON{
		ID:          page.ID,
		URL:         page.URL.RedactedString(),
		Title:       page.Title,
		Description: page.Description,
		Content:     page.Content,
		PublishedAt: formatTimestampPtr(page.PublishedAt),
		Read:        page.Read,
	}
}

func toSavedPagesJSON(pages []domain.SavedPage) []savedPageJSON {
	converted := make([]savedPageJSON, 0, len(pages))
	for _, page := range pages {
		converted = append(converted, toSavedPageJSON(page))
	}

	return converted
}

func toSavedPagePtr(page *domain.SavedPage) *savedPageJSON {
	if page == nil {
		return nil
	}

	converted := toSavedPageJSON(*page)

	return &converted
}

type savedPageRequest struct {
	URL string `json:"url"`
}

type readStateRequest struct {
	Read *bool `json:"read"`
}

type idsRequest struct {
	IDs []string `json:"ids"`
}

func (s *server) handleSavedPageList(w http.ResponseWriter, r *http.Request) {
	query, err := parsePageQuery(r)
	if err != nil {
		writeError(w, err)

		return
	}

	params, err := query.params(domain.SortOrderNewest)
	if err != nil {
		writeError(w, err)

		return
	}

	result, err := s.cfg.SavedPages.List(r.Context(), params)
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusOK, pageResponse[savedPageJSON]{Items: toSavedPagesJSON(result.Items), Cursor: result.Cursor})
}

func (s *server) handleSavedPageUnreadCount(w http.ResponseWriter, r *http.Request) {
	count, err := s.cfg.SavedPages.UnreadCount(r.Context())
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusOK, countResponse{Count: count})
}

func (s *server) handleSavedPageLookup(w http.ResponseWriter, r *http.Request) {
	pageURL, err := domain.ParseNormalizedURL(r.URL.Query().Get("url"), domain.ErrInvalidPageUrl)
	if err != nil {
		writeError(w, err)

		return
	}

	page, err := s.cfg.SavedPages.GetByURL(r.Context(), pageURL)
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusOK, itemResponse[savedPageJSON]{Item: toSavedPagePtr(page)})
}

func (s *server) handleSavedPageGet(w http.ResponseWriter, r *http.Request) {
	page, err := s.cfg.SavedPages.GetByID(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusOK, itemResponse[savedPageJSON]{Item: toSavedPagePtr(page)})
}

func (s *server) handleSavedPageCreate(w http.ResponseWriter, r *http.Request) {
	var req savedPageRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	pageURL, err := domain.ParseNormalizedURL(req.URL, domain.ErrInvalidPageUrl)
	if err != nil {
		writeError(w, err)

		return
	}

	created, err := s.createSavedPage(r.Context(), pageURL)
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusCreated, itemResponse[savedPageJSON]{Item: toSavedPagePtr(&created)})
}

func (s *server) createSavedPage(ctx context.Context, pageURL domain.NormalizedURL) (domain.SavedPage, error) {
	if err := s.ensureSavedPageAbsent(ctx, pageURL); err != nil {
		return domain.SavedPage{}, err
	}

	article, err := s.extractWebpage(ctx, pageURL)
	if err != nil {
		return domain.SavedPage{}, err
	}

	return s.cfg.SavedPages.Create(ctx, domain.SavedPage{
		ID:          domain.NewID(),
		URL:         pageURL,
		Title:       article.Title,
		Description: article.Description,
		Content:     article.Content,
		PublishedAt: article.PublishedAt,
	})
}

func (s *server) ensureSavedPageAbsent(ctx context.Context, pageURL domain.NormalizedURL) error {
	existing, err := s.cfg.SavedPages.GetByURL(ctx, pageURL)
	if err != nil {
		return err
	}

	if existing != nil {
		return domain.NewConflictURL(domain.ErrSavedPageAlreadyExists, pageURL.RedactedString())
	}

	return nil
}

func (s *server) handleSavedPageSetRead(w http.ResponseWriter, r *http.Request) {
	var req readStateRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	if req.Read == nil {
		writeError(w, domain.NewError(domain.ErrRequestFailed, nil))

		return
	}

	if err := s.cfg.SavedPages.SetRead(r.Context(), r.PathValue("id"), *req.Read); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleSavedPagesMarkRead(w http.ResponseWriter, r *http.Request) {
	var req idsRequest
	if err := decodeJSON(w, r, &req); err != nil {
		writeError(w, err)

		return
	}

	if err := s.cfg.SavedPages.MarkIDsRead(r.Context(), req.IDs); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleSavedPagesMarkAllRead(w http.ResponseWriter, r *http.Request) {
	if err := s.cfg.SavedPages.MarkAllRead(r.Context()); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleSavedPageDelete(w http.ResponseWriter, r *http.Request) {
	if err := s.cfg.SavedPages.Delete(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, err)

		return
	}

	writeNoContent(w)
}

func (s *server) handleFeedItemSave(w http.ResponseWriter, r *http.Request) {
	item, err := s.cfg.FeedItems.GetByID(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)

		return
	}

	if item == nil {
		writeError(w, domain.NewError(domain.ErrFeedItemNotFound, nil))

		return
	}

	created, err := s.saveFeedItem(r.Context(), item)
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusCreated, itemResponse[savedPageJSON]{Item: toSavedPagePtr(&created)})
}

func (s *server) saveFeedItem(ctx context.Context, item *domain.FeedItem) (domain.SavedPage, error) {
	if err := s.ensureSavedPageAbsent(ctx, item.URL); err != nil {
		return domain.SavedPage{}, err
	}

	page, err := s.savedPageFromFeedItem(ctx, item)
	if err != nil {
		return domain.SavedPage{}, err
	}

	return s.cfg.SavedPages.Create(ctx, page)
}

func (s *server) savedPageFromFeedItem(ctx context.Context, item *domain.FeedItem) (domain.SavedPage, error) {
	page := domain.SavedPage{
		ID:          domain.NewID(),
		URL:         item.URL,
		Title:       item.Title,
		Description: item.Description,
		PublishedAt: item.PublishedAt,
	}

	switch {
	case hasText(item.ExtractedContent):
		page.Content = *item.ExtractedContent
	case hasText(item.Content):
		page.Content = *item.Content
	default:
		article, err := s.extractWebpage(ctx, item.URL)
		if err != nil {
			return domain.SavedPage{}, err
		}

		page.Content = article.Content
		if strings.TrimSpace(article.Title) != "" {
			page.Title = article.Title
		}

		if article.Description != nil {
			page.Description = article.Description
		}

		if article.PublishedAt != nil {
			page.PublishedAt = article.PublishedAt
		}
	}

	return page, nil
}

func hasText(value *string) bool {
	return value != nil && strings.TrimSpace(*value) != ""
}

type countResponse struct {
	Count int `json:"count"`
}
