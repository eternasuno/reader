package httpserver

import (
	"context"
	"net/http"

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
	params, err := parseDefaultPageParams(r)
	if err != nil {
		writeError(w, err)

		return
	}

	result, err := s.cfg.SavedPages.List(r.Context(), params)
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusOK, pageResponse[savedPageJSON]{
		Items:    mapSlice(result.Items, toSavedPageJSON),
		Cursor:   result.Cursor,
		Boundary: params.Boundary,
	})
}

func (s *server) handleSavedPageUnreadCount(w http.ResponseWriter, r *http.Request) {
	boundary := domain.NewID()
	count, err := s.cfg.SavedPages.UnreadCount(r.Context(), boundary)
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusOK, countResponse{Count: count, Boundary: boundary})
}

func (s *server) handleSavedPageGet(w http.ResponseWriter, r *http.Request) {
	page, err := s.cfg.SavedPages.GetByID(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)

		return
	}

	writeJSON(w, http.StatusOK, itemResponse[savedPageJSON]{Item: toPtr(page, toSavedPageJSON)})
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

	converted := toSavedPageJSON(created)

	writeJSON(w, http.StatusCreated, itemResponse[savedPageJSON]{Item: &converted})
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
	id, found, err := s.cfg.SavedPages.GetIDByURL(ctx, pageURL)
	if err != nil {
		return err
	}

	if found {
		return domain.NewSavedPageConflict(id, pageURL.RedactedString())
	}

	return nil
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

	converted := toSavedPageJSON(created)

	writeJSON(w, http.StatusCreated, itemResponse[savedPageJSON]{Item: &converted})
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
	case item.ExtractedContent != nil:
		page.Content = *item.ExtractedContent
	case item.Content != nil:
		page.Content = *item.Content
	default:
		article, err := s.extractWebpage(ctx, item.URL)
		if err != nil {
			return domain.SavedPage{}, err
		}

		page.Content = article.Content
		page.Title = article.Title

		if article.Description != nil {
			page.Description = article.Description
		}

		if article.PublishedAt != nil {
			page.PublishedAt = article.PublishedAt
		}
	}

	return page, nil
}

type countResponse struct {
	Count    int    `json:"count"`
	Boundary string `json:"boundary"`
}
