package epub

import (
	"context"
	"time"

	"reader/internal/domain"
)

const (
	defaultImageConcurrency   = 4
	defaultImagePrepTimeout   = 2 * time.Minute
	defaultDecodeMemoryBudget = 64 << 20
)

type Config struct {
	ImageFetcher            domain.ImageFetcher
	MaxEPUBBytes            int
	ImageConcurrency        int
	ImagePrepTimeout        time.Duration
	ImageDecodeMemoryBudget int64
}

type Builder struct {
	imageFetcher       domain.ImageFetcher
	maxEPUBBytes       int
	imageConcurrency   int
	imagePrepTimeout   time.Duration
	decodeMemoryBudget int64
}

func NewBuilder(cfg Config) *Builder {
	maxEPUBBytes := cfg.MaxEPUBBytes
	if maxEPUBBytes <= 0 {
		maxEPUBBytes = domain.MaxKindleEPUBBytes
	}

	imageConcurrency := cfg.ImageConcurrency
	if imageConcurrency <= 0 {
		imageConcurrency = defaultImageConcurrency
	}

	imagePrepTimeout := cfg.ImagePrepTimeout
	if imagePrepTimeout <= 0 {
		imagePrepTimeout = defaultImagePrepTimeout
	}

	decodeBudget := cfg.ImageDecodeMemoryBudget
	if decodeBudget <= 0 {
		decodeBudget = defaultDecodeMemoryBudget
	}

	return &Builder{
		imageFetcher:       cfg.ImageFetcher,
		maxEPUBBytes:       maxEPUBBytes,
		imageConcurrency:   imageConcurrency,
		imagePrepTimeout:   imagePrepTimeout,
		decodeMemoryBudget: decodeBudget,
	}
}

func (b *Builder) BuildBooks(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
	if len(articles) == 0 {
		return nil, nil
	}

	if err := ctx.Err(); err != nil {
		return nil, err
	}

	chapters, err := parseChapters(ctx, articles)
	if err != nil {
		return nil, err
	}

	assets, err := b.prepareImages(ctx, chapters)
	if err != nil {
		return nil, err
	}

	return b.buildBooks(ctx, dateStr, chapters, assets)
}
