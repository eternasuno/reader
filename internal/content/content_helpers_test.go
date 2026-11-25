package content

import (
	"errors"
	"fmt"
	"io"
	"reader/internal/domain"
	"strings"
	"testing"
	"time"
)

func requireErrorCode(t *testing.T, err error, want domain.ErrorCode) {
	t.Helper()

	var domainErr *domain.DomainError
	if !errors.As(err, &domainErr) {
		t.Fatalf("expected *domain.DomainError, got %v", err)
	}

	if domainErr.Code != want {
		t.Fatalf("expected code %s, got %s", want, domainErr.Code)
	}
}

func requireContains(t *testing.T, value string, want string) {
	t.Helper()

	if !strings.Contains(value, want) {
		t.Fatalf("expected %q to contain %q", value, want)
	}
}

func requireNotContains(t *testing.T, value string, unwanted string) {
	t.Helper()

	if strings.Contains(value, unwanted) {
		t.Fatalf("expected %q to not contain %q", value, unwanted)
	}
}

func requireTime(t *testing.T, got *time.Time, want string) {
	t.Helper()

	if got == nil {
		t.Fatalf("expected published time %s, got none", want)
	}

	expected, err := time.Parse(time.RFC3339, want)
	if err != nil {
		t.Fatalf("invalid expected time %s: %v", want, err)
	}

	if !got.Equal(expected) {
		t.Fatalf("expected published time %s, got %s", expected, got.UTC())
	}
}

func parseFeed(t *testing.T, body string, baseURL string) domain.ParsedFeed {
	t.Helper()

	feed, err := NewFeedParser(NewSanitizer()).ParseFeed([]byte(body), baseURL)
	if err != nil {
		t.Fatalf("expected feed to parse, got %v", err)
	}

	return feed
}

type failingSanitizer struct {
	failOn string
}

func (f failingSanitizer) SanitizeHTML(rawHTML string, baseURL string) (string, error) {
	if strings.Contains(rawHTML, f.failOn) {
		return "", errors.New("sanitizer rejected html")
	}

	return "<p>sanitized</p>", nil
}

type streamingJSONFeedReader struct {
	totalItems   int
	itemsEmitted int
	bytesRead    int
	buf          []byte
	offset       int
	closed       bool
}

func newStreamingJSONFeedReader(totalItems int) *streamingJSONFeedReader {
	return &streamingJSONFeedReader{
		totalItems: totalItems,
		buf:        []byte(`{"version":"https://jsonfeed.org/version/1.1","title":"Feed","items":[`),
	}
}

func (r *streamingJSONFeedReader) Read(p []byte) (int, error) {
	if r.offset >= len(r.buf) {
		if r.closed {
			return 0, io.EOF
		}

		r.offset = 0
		if r.itemsEmitted < r.totalItems {
			prefix := ""
			if r.itemsEmitted > 0 {
				prefix = ","
			}

			r.buf = fmt.Appendf(r.buf[:0], `%s{"url":"https://example.com/%d","title":"Item %d"}`, prefix, r.itemsEmitted, r.itemsEmitted)
			r.itemsEmitted++
		} else {
			r.buf = append(r.buf[:0], "]}"...)
			r.closed = true
		}
	}

	n := copy(p, r.buf[r.offset:])
	r.offset += n
	r.bytesRead += n

	return n, nil
}
