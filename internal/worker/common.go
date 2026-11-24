package worker

import (
	"context"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"reader/internal/domain"
)

const maxLogErrorBytes = 512

// tickLoop calls fn on every interval tick until ctx is canceled.
func tickLoop(ctx context.Context, interval time.Duration, fn func(context.Context)) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			fn(ctx)
		}
	}
}

// logFailure logs err at level after removing secrets, flattening line breaks,
// and truncating to maxLogErrorBytes on a UTF-8 boundary.
func logFailure(level slog.Level, msg string, err error, attrs ...any) {
	args := make([]any, 0, len(attrs)+2)
	args = append(args, attrs...)
	args = append(args, "error", boundedLogError(err))
	slog.Log(context.Background(), level, msg, args...)
}

func boundedLogError(err error) string {
	if err == nil {
		return ""
	}

	clean := strings.NewReplacer("\r", " ", "\n", " ").Replace(domain.SanitizeErrorText(err.Error()))
	if len(clean) <= maxLogErrorBytes {
		return clean
	}

	const truncatedSuffix = "..."

	limit := maxLogErrorBytes - len(truncatedSuffix)
	for limit > 0 && !utf8.ValidString(clean[:limit]) {
		limit--
	}

	return clean[:limit] + truncatedSuffix
}
