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
	maxEPUBBytes := positiveIntOr(cfg.MaxEPUBBytes, domain.MaxKindleEPUBBytes)
	maxBookImageBytes := positiveInt64Or(cfg.MaxBookImageBytes, defaultMaxBookImageBytes)
	maxJobSpoolBytes := positiveInt64Or(cfg.MaxJobSpoolBytes, defaultMaxJobSpoolBytes)
	imageConcurrency := positiveIntOr(cfg.ImageConcurrency, defaultImageConcurrency)
	decodeBudget := positiveInt64Or(cfg.ImageDecodeMemoryBudget, defaultDecodeMemoryBudget)

	imagePrepTimeout := cfg.ImagePrepTimeout
	if imagePrepTimeout <= 0 {
		imagePrepTimeout = defaultImagePrepTimeout
	}

	return &Builder{
		imageFetcher:       cfg.ImageFetcher,
		maxEPUBBytes:       maxEPUBBytes,
		maxBookImageBytes:  maxBookImageBytes,
		maxJobSpoolBytes:   maxJobSpoolBytes,
		spoolDir:           cfg.SpoolDir,
		imageConcurrency:   imageConcurrency,
		imagePrepTimeout:   imagePrepTimeout,
		decodeMemoryBudget: decodeBudget,
	}
}

func positiveIntOr(value int, fallback int) int {
	if value <= 0 {
		return fallback
	}

	return value
}

func positiveInt64Or(value int64, fallback int64) int64 {
	if value <= 0 {
		return fallback
	}

	return value
}

func (b *Builder) NewPacker(ctx context.Context, dateStr string) (domain.EPUBPacker, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	return newPacker(b, dateStr), nil
}
