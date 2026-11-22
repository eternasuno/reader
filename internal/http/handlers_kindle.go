package httpserver

import (
	"errors"
	"net/http"

	"reader/internal/domain"
)

type kindleSendRecordJSON struct {
	ID           string               `json:"id"`
	Trigger      domain.KindleTrigger `json:"trigger"`
	Status       domain.KindleStatus  `json:"status"`
	ArticleCount int                  `json:"articleCount"`
	BookCount    int                  `json:"bookCount"`
	Error        *string              `json:"error,omitempty"`
	StartedAt    string               `json:"startedAt"`
	FinishedAt   *string              `json:"finishedAt,omitempty"`
}

func toKindleSendRecordJSON(record domain.KindleSendRecord) kindleSendRecordJSON {
	return kindleSendRecordJSON{
		ID:           record.ID,
		Trigger:      record.Trigger,
		Status:       record.Status,
		ArticleCount: record.ArticleCount,
		BookCount:    record.BookCount,
		Error:        record.Error,
		StartedAt:    formatTimestamp(record.StartedAt),
		FinishedAt:   formatTimestampPtr(record.FinishedAt),
	}
}

type kindleSendsResponse struct {
	Running bool                   `json:"running"`
	Items   []kindleSendRecordJSON `json:"items"`
}

func (s *server) handleKindleSend(w http.ResponseWriter, r *http.Request) {
	if s.cfg.Kindle == nil {
		writeError(w, errors.New("kindle dispatcher is not configured"))

		return
	}

	record, err := s.cfg.Kindle.EnqueueManual(r.Context())
	if err != nil {
		writeError(w, err)

		return
	}

	converted := toKindleSendRecordJSON(record)

	writeJSON(w, http.StatusAccepted, itemResponse[kindleSendRecordJSON]{Item: &converted})
}

func (s *server) handleKindleSends(w http.ResponseWriter, r *http.Request) {
	records, err := s.cfg.KindleSends.ListRecent(r.Context())
	if err != nil {
		writeError(w, err)

		return
	}

	running := s.cfg.Kindle != nil && s.cfg.Kindle.IsRunning()
	items := make([]kindleSendRecordJSON, 0, len(records))
	for _, record := range records {
		if record.Status == domain.KindleStatusRunning {
			running = true
		}

		items = append(items, toKindleSendRecordJSON(record))
	}

	writeJSON(w, http.StatusOK, kindleSendsResponse{Running: running, Items: items})
}
