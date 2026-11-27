package epub

import (
	"cmp"
	"context"
	"time"

	"reader/internal/domain"
)

const (
	defaultImageConcurrency   = 4
	defaultImagePrepTimeout   = 2 * time.Minute
	defaultDecodeMemoryBudget = 64 << 20
	defaultMaxBookImageBytes  = 32 << 20
	defaultMaxJobSpoolBytes   = 512 << 20
)

type Config struct {
	ImageFetcher            domain.ImageFetcher
	MaxEPUBBytes            int
	MaxBookImageBytes       int64
	MaxJobSpoolBytes        int64
	SpoolDir                string
	ImageConcurrency        int
	ImagePrepTimeout        time.Duration
	ImageDecodeMemoryBudget int64
	CoverImage              []byte
}

type Builder struct {
	imageFetcher       domain.ImageFetcher
	maxEPUBBytes       int
	maxBookImageBytes  int64
	maxJobSpoolBytes   int64
	spoolDir           string
	imageConcurrency   int
	imagePrepTimeout   time.Duration
	decodeMemoryBudget int64
	coverImage         []byte
}

func NewBuilder(cfg Config) *Builder {
	coverImage := cfg.CoverImage
	if len(coverImage) == 0 {
		coverImage = coverJPEG
	}

	return &Builder{
		imageFetcher:       cfg.ImageFetcher,
		maxEPUBBytes:       cmp.Or(cfg.MaxEPUBBytes, domain.MaxKindleEPUBBytes),
		maxBookImageBytes:  cmp.Or(cfg.MaxBookImageBytes, defaultMaxBookImageBytes),
		maxJobSpoolBytes:   cmp.Or(cfg.MaxJobSpoolBytes, defaultMaxJobSpoolBytes),
		spoolDir:           cfg.SpoolDir,
		imageConcurrency:   cmp.Or(cfg.ImageConcurrency, defaultImageConcurrency),
		imagePrepTimeout:   cmp.Or(cfg.ImagePrepTimeout, defaultImagePrepTimeout),
		decodeMemoryBudget: cmp.Or(cfg.ImageDecodeMemoryBudget, defaultDecodeMemoryBudget),
		coverImage:         coverImage,
	}
}

func (b *Builder) NewPacker(ctx context.Context, dateStr string, language domain.KindleLanguage) (domain.EPUBPacker, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	locale, err := localeFor(language)
	if err != nil {
		return nil, err
	}

	return newPacker(b, dateStr, locale), nil
}
