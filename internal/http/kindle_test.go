package httpserver

import (
	"context"
	"net/http"
	"reader/internal/domain"
	"testing"
	"time"
)

func TestKindleSend(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	started := time.Date(2026, time.March, 1, 7, 0, 0, 0, time.UTC)
	h.kindle.record = domain.KindleSendRecord{
		ID:        domain.NewID(),
		Trigger:   domain.KindleTriggerManual,
		Status:    domain.KindleStatusRunning,
		StartedAt: started,
	}

	recorder := h.authed(http.MethodPost, "/api/kindle/send", nil)
	requireStatus(t, recorder, http.StatusAccepted)

	var queued itemResponse[kindleSendRecordJSON]
	decodeBody(t, recorder, &queued)
	if queued.Item == nil {
		t.Fatal("send response has no item")
	}

	if queued.Item.Status != domain.KindleStatusRunning || queued.Item.Trigger != domain.KindleTriggerManual {
		t.Fatalf("queued record = %+v", queued.Item)
	}

	if queued.Item.StartedAt != "2026-03-01T07:00:00Z" {
		t.Fatalf("startedAt = %q", queued.Item.StartedAt)
	}

	if h.kindle.calls != 1 {
		t.Fatalf("enqueue calls = %d", h.kindle.calls)
	}

	h.kindle.err = domain.NewError(domain.ErrKindleSendInProgress, nil)
	requireAPIError(t, h.authed(http.MethodPost, "/api/kindle/send", nil), http.StatusConflict, "KindleSendInProgress")

	h.kindle.err = domain.NewError(domain.ErrKindleNotConfigured, nil)
	requireAPIError(t, h.authed(http.MethodPost, "/api/kindle/send", nil), http.StatusUnprocessableEntity, "KindleNotConfigured")
}

func TestKindleSendsList(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	ctx := context.Background()
	started := time.Date(2026, time.March, 1, 7, 0, 0, 0, time.UTC)
	finished := started.Add(3 * time.Minute)
	if _, err := h.db.WriteDB().ExecContext(
		ctx,
		`INSERT INTO kindle_send (id, trigger, status, article_count, book_count, error, started_at, finished_at) VALUES (?, 'scheduled', 'failed', 5, 2, 'smtp rejected the message', ?, ?)`,
		domain.NewID(),
		started.UnixMilli(),
		finished.UnixMilli(),
	); err != nil {
		t.Fatalf("insert failed kindle send: %v", err)
	}

	recorder := h.authed(http.MethodGet, "/api/kindle/sends", nil)
	requireStatus(t, recorder, http.StatusOK)

	var payload kindleSendsResponse
	decodeBody(t, recorder, &payload)
	if payload.Running {
		t.Fatal("no send is running")
	}

	if len(payload.Items) != 1 {
		t.Fatalf("sends = %+v", payload.Items)
	}

	record := payload.Items[0]
	if record.Status != domain.KindleStatusFailed || record.ArticleCount != 5 || record.BookCount != 2 {
		t.Fatalf("record = %+v", record)
	}

	if record.Error == nil || *record.Error != "smtp rejected the message" {
		t.Fatalf("record error = %v", record.Error)
	}

	if record.StartedAt != "2026-03-01T07:00:00Z" || record.FinishedAt == nil || *record.FinishedAt != "2026-03-01T07:03:00Z" {
		t.Fatalf("record timestamps = %q / %v", record.StartedAt, record.FinishedAt)
	}

	if _, err := h.db.WriteDB().ExecContext(
		ctx,
		`INSERT INTO kindle_send (id, trigger, status, article_count, book_count, started_at) VALUES (?, 'manual', 'running', 0, 0, ?)`,
		domain.NewID(),
		started.Add(time.Minute).UnixMilli(),
	); err != nil {
		t.Fatalf("insert running kindle send: %v", err)
	}

	recorder = h.authed(http.MethodGet, "/api/kindle/sends", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &payload)
	if !payload.Running {
		t.Fatal("a running record must report running = true")
	}
}
