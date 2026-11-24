package epub

import (
	"context"

	"reader/internal/domain"
)

// BuildBooks materializes every book for tests.
func (b *Builder) BuildBooks(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
	if len(articles) == 0 {
		return nil, ctx.Err()
	}

	packer, err := b.NewPacker(ctx, dateStr)
	if err != nil {
		return nil, err
	}
	defer func() { _ = packer.Close() }()

	for _, article := range articles {
		if err := packer.AddArticle(ctx, article); err != nil {
			return nil, err
		}
	}

	count, err := packer.Finish(ctx)
	if err != nil {
		return nil, err
	}

	books := make([]domain.EPUBBook, 0, count)
	for i := range count {
		book, err := packer.ReadBook(ctx, i)
		if err != nil {
			return nil, err
		}

		books = append(books, book)
	}

	return books, nil
}
