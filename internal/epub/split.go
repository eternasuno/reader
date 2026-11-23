package epub

import (
	"context"

	"reader/internal/domain"
)

func (b *Builder) buildBooks(
	ctx context.Context,
	dateStr string,
	chapters []chapterInput,
	assets map[string]preparedImage,
) ([]domain.EPUBBook, error) {
	return domain.SplitKindleBooks(
		chapters,
		dateStr,
		b.maxEPUBBytes,
		chapterID,
		func(chunk []chapterInput, title string, filename string, textOnly bool) (domain.EPUBBook, int, error) {
			data, err := renderEPUB(ctx, title, chunk, assets, textOnly)
			if err != nil {
				return domain.EPUBBook{}, 0, err
			}

			savedPageIDs, feedItemIDs := collectArticleIDs(chunk)

			return domain.EPUBBook{
				Title:        title,
				Filename:     filename,
				Data:         data,
				SavedPageIDs: savedPageIDs,
				FeedItemIDs:  feedItemIDs,
				ArticleCount: len(chunk),
			}, len(data), nil
		},
	)
}

func chapterID(ch chapterInput) string {
	return ch.article.ID
}

func collectArticleIDs(chapters []chapterInput) ([]string, []string) {
	savedPageIDs := make([]string, 0, len(chapters))
	feedItemIDs := make([]string, 0, len(chapters))
	for _, ch := range chapters {
		if ch.article.IsSavedPage {
			savedPageIDs = append(savedPageIDs, ch.article.ID)
			continue
		}

		feedItemIDs = append(feedItemIDs, ch.article.ID)
	}

	return savedPageIDs, feedItemIDs
}
