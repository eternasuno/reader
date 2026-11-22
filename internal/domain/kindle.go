package domain

import "fmt"

const MaxKindleEPUBBytes = 20 * 1024 * 1024

type KindleSplitAction string

const (
	KindleActionAccept        KindleSplitAction = "accept"
	KindleActionSplitHalves   KindleSplitAction = "split_halves"
	KindleActionRetryTextOnly KindleSplitAction = "retry_text_only"
	KindleActionFailOversize  KindleSplitAction = "fail_oversize"
)

func HalveKindleArticles(articles []KindleArticle) ([]KindleArticle, []KindleArticle) {
	if len(articles) <= 1 {
		return articles, nil
	}

	mid := len(articles) / 2

	return articles[:mid], articles[mid:]
}

// DecideKindleSplit picks the next step after an EPUB has been encoded.
func DecideKindleSplit(articleCount int, encodedBytes int, maxBytes int, textOnly bool) KindleSplitAction {
	if maxBytes <= 0 {
		maxBytes = MaxKindleEPUBBytes
	}

	if encodedBytes <= maxBytes {
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

// SplitKindleChunks builds one or more EPUB payloads in book order, halving the
// article list until every chunk fits or a single article cannot be reduced.
func SplitKindleChunks[T any](articles []KindleArticle, maxBytes int, build func(chunk []KindleArticle, textOnly bool) (T, int, error)) ([]T, error) {
	if maxBytes <= 0 {
		maxBytes = MaxKindleEPUBBytes
	}

	if len(articles) == 0 {
		return nil, nil
	}

	return splitKindleChunks(articles, maxBytes, build)
}

func splitKindleChunks[T any](articles []KindleArticle, maxBytes int, build func(chunk []KindleArticle, textOnly bool) (T, int, error)) ([]T, error) {
	built, encodedBytes, err := build(articles, false)
	if err != nil {
		return nil, err
	}

	switch DecideKindleSplit(len(articles), encodedBytes, maxBytes, false) {
	case KindleActionAccept:
		return []T{built}, nil
	case KindleActionSplitHalves:
		return splitKindleHalves(articles, maxBytes, build)
	case KindleActionRetryTextOnly:
		return buildTextOnlyKindleChunk(articles, maxBytes, build)
	default:
		return nil, fmt.Errorf("kindle article %q is %d bytes, exceeding the %d byte limit", articles[0].ID, encodedBytes, maxBytes)
	}
}

func splitKindleHalves[T any](articles []KindleArticle, maxBytes int, build func(chunk []KindleArticle, textOnly bool) (T, int, error)) ([]T, error) {
	left, right := HalveKindleArticles(articles)

	books, err := splitKindleChunks(left, maxBytes, build)
	if err != nil {
		return nil, err
	}

	tail, err := splitKindleChunks(right, maxBytes, build)
	if err != nil {
		return nil, err
	}

	return append(books, tail...), nil
}

func buildTextOnlyKindleChunk[T any](articles []KindleArticle, maxBytes int, build func(chunk []KindleArticle, textOnly bool) (T, int, error)) ([]T, error) {
	textBuilt, textBytes, err := build(articles, true)
	if err != nil {
		return nil, err
	}

	if DecideKindleSplit(len(articles), textBytes, maxBytes, true) == KindleActionAccept {
		return []T{textBuilt}, nil
	}

	return nil, fmt.Errorf("kindle article %q is %d bytes even without images, exceeding the %d byte limit", articles[0].ID, textBytes, maxBytes)
}

func FormatKindleBookMeta(dateStr string, index int, total int) (title string, filename string) {
	if total <= 1 {
		return fmt.Sprintf("留白 %s", dateStr), fmt.Sprintf("liubai-%s.epub", dateStr)
	}

	return fmt.Sprintf("留白 %s (%d/%d)", dateStr, index, total), fmt.Sprintf("liubai-%s-%d.epub", dateStr, index)
}
