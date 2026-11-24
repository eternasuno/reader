package domain

import (
	"fmt"
	"strings"
)

const MaxKindleEPUBBytes = 20 * 1024 * 1024

// IsKindleDeliveryUsable reports whether both SMTP and Kindle delivery settings
// have the required non-blank fields and valid port to send mail.
func IsKindleDeliveryUsable(settings Settings) bool {
	return settings.SMTP != nil &&
		settings.Kindle != nil &&
		strings.TrimSpace(settings.Kindle.KindleEmail) != "" &&
		strings.TrimSpace(settings.SMTP.SenderEmail) != "" &&
		strings.TrimSpace(settings.SMTP.Host) != "" &&
		settings.SMTP.Port >= 1 &&
		settings.SMTP.Port <= 65535
}

// CloneKindleDelivery deep-copies SMTP and Kindle delivery settings so later
// settings updates never mutate an already accepted job.
func CloneKindleDelivery(smtp SMTPSettings, kindleEmail string) KindleDelivery {
	clonedSMTP := smtp
	clonedSMTP.User = cloneStringPtr(smtp.User)
	clonedSMTP.Password = cloneStringPtr(smtp.Password)

	return KindleDelivery{
		SMTP:        clonedSMTP,
		KindleEmail: kindleEmail,
	}
}

func cloneStringPtr(value *string) *string {
	if value == nil {
		return nil
	}

	cloned := *value

	return &cloned
}

// OversizeKindleArticleError formats the user-facing error when a single article
// exceeds the EPUB size limit.
func OversizeKindleArticleError(id string, size int, maxBytes int, textOnly bool) error {
	if textOnly {
		return fmt.Errorf("kindle article %q is %d bytes even without images, exceeding the %d byte limit", id, size, maxBytes)
	}

	return fmt.Errorf("kindle article %q is %d bytes, exceeding the %d byte limit", id, size, maxBytes)
}

func FormatKindleBookMeta(dateStr string, index int, total int) (title string, filename string) {
	if total <= 1 {
		return fmt.Sprintf("拾叶 %s", dateStr), fmt.Sprintf("leaf-%s.epub", dateStr)
	}

	return fmt.Sprintf("拾叶 %s (%d/%d)", dateStr, index, total), fmt.Sprintf("leaf-%s-%d.epub", dateStr, index)
}
