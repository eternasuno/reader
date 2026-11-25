package domain

import (
	"errors"
	"fmt"
)

const MaxKindleEPUBBytes = 20 * 1024 * 1024

var ErrKindleSendNotFound = errors.New("kindle send not found")

// OversizeKindleArticleError formats the user-facing error when a single article
// exceeds the EPUB size limit.
func OversizeKindleArticleError(id string, size int, maxBytes int) error {
	return fmt.Errorf("kindle article %q is %d bytes even without images, exceeding the %d byte limit", id, size, maxBytes)
}

func FormatKindleBookMeta(dateStr string, index int, total int) (title string, filename string) {
	if total <= 1 {
		return fmt.Sprintf("Lantern %s", dateStr), fmt.Sprintf("lantern-%s.epub", dateStr)
	}

	return fmt.Sprintf("Lantern %s (%d/%d)", dateStr, index, total), fmt.Sprintf("lantern-%s-%d.epub", dateStr, index)
}
