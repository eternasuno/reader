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
}

func NewBuilder(cfg Config) *Builder {
	return &Builder{
		imageFetcher:       cfg.ImageFetcher,
		maxEPUBBytes:       cmp.Or(cfg.MaxEPUBBytes, domain.MaxKindleEPUBBytes),
		maxBookImageBytes:  cmp.Or(cfg.MaxBookImageBytes, defaultMaxBookImageBytes),
		maxJobSpoolBytes:   cmp.Or(cfg.MaxJobSpoolBytes, defaultMaxJobSpoolBytes),
		spoolDir:           cfg.SpoolDir,
		imageConcurrency:   cmp.Or(cfg.ImageConcurrency, defaultImageConcurrency),
		imagePrepTimeout:   cmp.Or(cfg.ImagePrepTimeout, defaultImagePrepTimeout),
		decodeMemoryBudget: cmp.Or(cfg.ImageDecodeMemoryBudget, defaultDecodeMemoryBudget),
	}
}

func (b *Builder) NewPacker(ctx context.Context, dateStr string) (domain.EPUBPacker, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	return newPacker(b, dateStr), nil
}
