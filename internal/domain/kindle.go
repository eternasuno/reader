package domain

import (
	"fmt"
	"strings"
)

const MaxKindleEPUBBytes = 20 * 1024 * 1024

type KindleSplitAction string

const (
	KindleActionAccept        KindleSplitAction = "accept"
	KindleActionSplitHalves   KindleSplitAction = "split_halves"
	KindleActionRetryTextOnly KindleSplitAction = "retry_text_only"
	KindleActionFailOversize  KindleSplitAction = "fail_oversize"
)

type kindlePartition[Item any] struct {
	items    []Item
	textOnly bool
}

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

// HalveSlice splits items into two contiguous halves preserving order.
func HalveSlice[T any](items []T) ([]T, []T) {
	if len(items) <= 1 {
		return items, nil
	}

	mid := len(items) / 2

	return items[:mid], items[mid:]
}

// DecideKindleSplit picks the next step after an EPUB has been encoded.
func DecideKindleSplit(articleCount int, encodedBytes int, maxBytes int, textOnly bool) KindleSplitAction {
	effectiveMax := normalizeMaxEPUBBytes(maxBytes)

	if encodedBytes <= effectiveMax {
		return KindleActionAccept
	}

	if articleCount > 1 {
		return KindleActionSplitHalves
	}

	if !textOnly {
		return KindleActionRetryTextOnly
	}

	return KindleActionFailOversize
}

// SplitKindleBooks partitions items in order into bounded-size books, owning
// recursive halving, text-only fallback, and final-title verification.
func SplitKindleBooks[Item any, Book any](
	items []Item,
	dateStr string,
	maxBytes int,
	itemID func(Item) string,
	render func(chunk []Item, title string, filename string, textOnly bool) (Book, int, error),
) ([]Book, error) {
	if len(items) == 0 {
		return nil, nil
	}

	effectiveMax := normalizeMaxEPUBBytes(maxBytes)
	measureTitle, _ := FormatKindleBookMeta(dateStr, len(items), len(items))

	partitions, err := planKindlePartitions(items, measureTitle, effectiveMax, itemID, render)
	if err != nil {
		return nil, err
	}

	return verifyKindlePartitions(partitions, dateStr, effectiveMax, itemID, render)
}

func normalizeMaxEPUBBytes(maxBytes int) int {
	if maxBytes <= 0 {
		return MaxKindleEPUBBytes
	}

	return maxBytes
}

func planKindlePartitions[Item any, Book any](
	items []Item,
	measureTitle string,
	maxBytes int,
	itemID func(Item) string,
	render func(chunk []Item, title string, filename string, textOnly bool) (Book, int, error),
) ([]kindlePartition[Item], error) {
	_, encodedBytes, err := render(items, measureTitle, "", false)
	if err != nil {
		return nil, err
	}

	switch DecideKindleSplit(len(items), encodedBytes, maxBytes, false) {
	case KindleActionAccept:
		return []kindlePartition[Item]{{items: items}}, nil
	case KindleActionSplitHalves:
		return splitKindleHalves(items, measureTitle, maxBytes, itemID, render)
	case KindleActionRetryTextOnly:
		return planTextOnlyPartition(items, measureTitle, maxBytes, itemID, render)
	default:
		return nil, oversizeArticleError(itemID(items[0]), encodedBytes, maxBytes, false)
	}
}

func splitKindleHalves[Item any, Book any](
	items []Item,
	measureTitle string,
	maxBytes int,
	itemID func(Item) string,
	render func(chunk []Item, title string, filename string, textOnly bool) (Book, int, error),
) ([]kindlePartition[Item], error) {
	left, right := HalveSlice(items)

	head, err := planKindlePartitions(left, measureTitle, maxBytes, itemID, render)
	if err != nil {
		return nil, err
	}

	tail, err := planKindlePartitions(right, measureTitle, maxBytes, itemID, render)
	if err != nil {
		return nil, err
	}

	return append(head, tail...), nil
}

func planTextOnlyPartition[Item any, Book any](
	items []Item,
	measureTitle string,
	maxBytes int,
	itemID func(Item) string,
	render func(chunk []Item, title string, filename string, textOnly bool) (Book, int, error),
) ([]kindlePartition[Item], error) {
	_, textBytes, err := render(items, measureTitle, "", true)
	if err != nil {
		return nil, err
	}

	if DecideKindleSplit(len(items), textBytes, maxBytes, true) == KindleActionAccept {
		return []kindlePartition[Item]{{items: items, textOnly: true}}, nil
	}

	return nil, oversizeArticleError(itemID(items[0]), textBytes, maxBytes, true)
}

func verifyKindlePartitions[Item any, Book any](
	partitions []kindlePartition[Item],
	dateStr string,
	maxBytes int,
	itemID func(Item) string,
	render func(chunk []Item, title string, filename string, textOnly bool) (Book, int, error),
) ([]Book, error) {
	current := partitions
	for {
		books, splitIndex, err := renderKindlePartitions(current, dateStr, maxBytes, itemID, render)
		if err != nil {
			return nil, err
		}

		if splitIndex < 0 {
			return books, nil
		}

		left, right := HalveSlice(current[splitIndex].items)
		next := make([]kindlePartition[Item], 0, len(current)+1)
		next = append(next, current[:splitIndex]...)
		next = append(next, kindlePartition[Item]{items: left}, kindlePartition[Item]{items: right})
		next = append(next, current[splitIndex+1:]...)
		current = next
	}
}

func renderKindlePartitions[Item any, Book any](
	partitions []kindlePartition[Item],
	dateStr string,
	maxBytes int,
	itemID func(Item) string,
	render func(chunk []Item, title string, filename string, textOnly bool) (Book, int, error),
) ([]Book, int, error) {
	books := make([]Book, len(partitions))
	for i := range partitions {
		book, splitNeeded, err := renderPartition(partitions, i, dateStr, maxBytes, itemID, render)
		if err != nil {
			return nil, -1, err
		}

		if splitNeeded {
			return nil, i, nil
		}

		books[i] = book
	}

	return books, -1, nil
}

func renderPartition[Item any, Book any](
	partitions []kindlePartition[Item],
	index int,
	dateStr string,
	maxBytes int,
	itemID func(Item) string,
	render func(chunk []Item, title string, filename string, textOnly bool) (Book, int, error),
) (Book, bool, error) {
	var zero Book
	part := &partitions[index]
	title, filename := FormatKindleBookMeta(dateStr, index+1, len(partitions))

	book, encodedBytes, err := render(part.items, title, filename, part.textOnly)
	if err != nil {
		return zero, false, err
	}

	switch DecideKindleSplit(len(part.items), encodedBytes, maxBytes, part.textOnly) {
	case KindleActionAccept:
		return book, false, nil
	case KindleActionSplitHalves:
		return zero, true, nil
	case KindleActionRetryTextOnly:
		textBook, textBytes, textErr := render(part.items, title, filename, true)
		if textErr != nil {
			return zero, false, textErr
		}

		if DecideKindleSplit(len(part.items), textBytes, maxBytes, true) != KindleActionAccept {
			return zero, false, oversizeArticleError(itemID(part.items[0]), textBytes, maxBytes, true)
		}

		part.textOnly = true
		return textBook, false, nil
	default:
		return zero, false, oversizeArticleError(itemID(part.items[0]), encodedBytes, maxBytes, true)
	}
}

func oversizeArticleError(id string, size int, maxBytes int, textOnly bool) error {
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
