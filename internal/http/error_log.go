package httpserver

import (
	"log/slog"
	"strings"

	"reader/internal/domain"
)

const maxLogErrorRunes = 512

// logInternalError records the cause of a 5xx response, which the JSON body
// deliberately omits, so failures can be located from server logs.
func logInternalError(code domain.ErrorCode, err error) {
	slog.Error("request failed", "code", string(code), "error", boundedErrorText(err))
}

func boundedErrorText(err error) string {
	if err == nil {
		return ""
	}

	clean := strings.NewReplacer("\r", " ", "\n", " ").Replace(domain.SanitizeErrorText(err.Error()))

	runes := []rune(clean)
	if len(runes) <= maxLogErrorRunes {
		return clean
	}

	return string(runes[:maxLogErrorRunes]) + "..."
}
