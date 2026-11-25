package httpserver

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"reader/internal/domain"
)

func captureLogs(t *testing.T) *bytes.Buffer {
	t.Helper()

	var buf bytes.Buffer

	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	t.Cleanup(func() { slog.SetDefault(previous) })

	return &buf
}

func TestWriteErrorLogsSanitizedCauseOnServerError(t *testing.T) {
	logs := captureLogs(t)
	cause := errors.New("query failed for https://user:hunter2@example.com/feed\nsecond line")
	rec := httptest.NewRecorder()

	writeError(rec, domain.NewError(domain.ErrFeedRepositoryError, cause))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}

	if strings.Contains(rec.Body.String(), "query failed") {
		t.Fatalf("response body leaks the cause: %s", rec.Body.String())
	}

	out := logs.String()
	for _, want := range []string{"request failed", "FeedRepositoryError", "query failed"} {
		if !strings.Contains(out, want) {
			t.Fatalf("log %q missing %q", out, want)
		}
	}

	if strings.Contains(out, "hunter2") {
		t.Fatalf("log leaks URL credentials: %s", out)
	}

	if strings.Count(out, "\n") != 1 {
		t.Fatalf("log must be a single line, got %q", out)
	}
}

func TestWriteErrorDoesNotLogClientErrors(t *testing.T) {
	logs := captureLogs(t)

	writeError(httptest.NewRecorder(), domain.NewError(domain.ErrInvalidPageUrl, nil))

	if logs.Len() != 0 {
		t.Fatalf("client error was logged: %s", logs.String())
	}
}

func TestBoundedErrorTextTruncatesOnRuneBoundary(t *testing.T) {
	got := boundedErrorText(errors.New(strings.Repeat("错", maxLogErrorRunes+10)))

	if want := strings.Repeat("错", maxLogErrorRunes) + "..."; got != want {
		t.Fatalf("bounded text length = %d runes, want %d", len([]rune(got)), len([]rune(want)))
	}
}
