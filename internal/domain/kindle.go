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

// FormatKindleBookMeta names a book; an empty dateStr (manual sends) omits the date.
func FormatKindleBookMeta(dateStr string, index int, total int) (title string, filename string) {
	title, filename = "Lantern", "lantern"
	if dateStr != "" {
		title += " " + dateStr
		filename += "-" + dateStr
	}

	if total <= 1 {
		return title, filename + ".epub"
	}

	return fmt.Sprintf("%s (%d/%d)", title, index, total), fmt.Sprintf("%s-%d.epub", filename, index)
}
