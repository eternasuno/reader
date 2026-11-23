package epub

import (
	"bytes"
	"context"
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"strings"
	"sync"
)

const (
	maxEPUBImageWidth        = 1200
	maxEPUBImageHeight       = 1600
	imageReencodeMinBytes    = 128 << 10
	maxImageDecodeDimension  = 6144
	maxImageDecodePixels     = 12_000_000
	bytesPerRGBAPixel        = 4
	bytesPerRGBA64Pixel      = 8
	pngDecoderOverheadBytes  = 512 << 10
	jpegDecoderOverheadBytes = 512 << 10
	// A progressive JPEG keeps one [64]int32 block (256 bytes) per 8x8 samples
	// of every component until the last scan, i.e. 4 bytes per component pixel.
	jpegCoefficientBytesPerPixel = 4
	epubJPEGQuality              = 75
)

type imageFormat struct {
	mediaType   string
	ext         string
	decodeName  string
	optimizable bool
}

var (
	jpegFormat = imageFormat{mediaType: "image/jpeg", ext: ".jpg", decodeName: "jpeg", optimizable: true}
	pngFormat  = imageFormat{mediaType: "image/png", ext: ".png", decodeName: "png", optimizable: true}
	gifFormat  = imageFormat{mediaType: "image/gif", ext: ".gif", decodeName: "gif", optimizable: false}
)

type preparedImage struct {
	format imageFormat
	data   []byte
}

func (img preparedImage) valid() bool {
	return len(img.data) > 0 && img.format.mediaType != ""
}

type decodeBudget struct {
	mu      sync.Mutex
	limit   int64
	inUse   int64
	changed chan struct{}
}

func newDecodeBudget(limit int64) *decodeBudget {
	return &decodeBudget{
		limit:   limit,
		changed: make(chan struct{}),
	}
}

func (d *decodeBudget) acquire(ctx context.Context, needed int64) bool {
	if needed <= 0 || needed > d.limit {
		return false
	}

	for {
		d.mu.Lock()
		if d.inUse+needed <= d.limit {
			d.inUse += needed
			d.mu.Unlock()
			return true
		}
		waitCh := d.changed
		d.mu.Unlock()

		select {
		case <-ctx.Done():
			return false
		case <-waitCh:
		}
	}
}

func (d *decodeBudget) release(amount int64) {
	d.mu.Lock()
	d.inUse -= amount
	close(d.changed)
	d.changed = make(chan struct{})
	d.mu.Unlock()
}

func (b *Builder) prepareImages(ctx context.Context, chapters []chapterInput) (map[string]preparedImage, error) {
	orderedURLs := collectOrderedImageURLs(chapters)
	if len(orderedURLs) == 0 || b.imageFetcher == nil {
		return nil, ctx.Err()
	}

	prepCtx, cancelPrep := context.WithTimeout(ctx, b.imagePrepTimeout)
	defer cancelPrep()

	results := b.fetchAndPrepareImages(prepCtx, orderedURLs)
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	assets := make(map[string]preparedImage, len(orderedURLs))
	for i, rawURL := range orderedURLs {
		if results[i].valid() {
			assets[rawURL] = results[i]
		}
	}

	return assets, nil
}

func collectOrderedImageURLs(chapters []chapterInput) []string {
	ordered := make([]string, 0)
	seen := make(map[string]struct{})

	for _, ch := range chapters {
		for _, rawURL := range ch.imgURLs {
			if _, ok := seen[rawURL]; ok {
				continue
			}

			seen[rawURL] = struct{}{}
			ordered = append(ordered, rawURL)
		}
	}

	return ordered
}

func (b *Builder) fetchAndPrepareImages(ctx context.Context, urls []string) []preparedImage {
	results := make([]preparedImage, len(urls))
	queue := make(chan int, len(urls))
	for i := range urls {
		queue <- i
	}
	close(queue)

	budget := newDecodeBudget(b.decodeMemoryBudget)
	var waitGroup sync.WaitGroup
	for range min(b.imageConcurrency, len(urls)) {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			for idx := range queue {
				if ctx.Err() != nil {
					return
				}

				results[idx] = b.prepareOneImage(ctx, urls[idx], budget)
			}
		}()
	}

	waitGroup.Wait()

	return results
}

func (b *Builder) prepareOneImage(ctx context.Context, rawURL string, budget *decodeBudget) preparedImage {
	data, mediaType, ext, err := b.imageFetcher.FetchImage(ctx, rawURL)
	if err != nil || len(data) == 0 {
		return preparedImage{}
	}

	fmtInfo, ok := normalizeImageFormat(mediaType, ext)
	if !ok {
		return preparedImage{}
	}

	cfg, valid := validateImageConfig(data, fmtInfo)
	if !valid {
		return preparedImage{}
	}

	return b.optimizeOrKeepImage(ctx, data, fmtInfo, cfg, budget)
}

func validateImageConfig(data []byte, fmtInfo imageFormat) (image.Config, bool) {
	cfg, decodedName, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || decodedName != fmtInfo.decodeName {
		return image.Config{}, false
	}

	if cfg.Width <= 0 || cfg.Height <= 0 {
		return image.Config{}, false
	}

	if cfg.Width > maxImageDecodeDimension || cfg.Height > maxImageDecodeDimension {
		return image.Config{}, false
	}

	if int64(cfg.Width)*int64(cfg.Height) > maxImageDecodePixels {
		return image.Config{}, false
	}

	return cfg, true
}

func (b *Builder) optimizeOrKeepImage(ctx context.Context, data []byte, fmtInfo imageFormat, cfg image.Config, budget *decodeBudget) preparedImage {
	if !fmtInfo.optimizable || !needsOptimization(cfg, len(data)) {
		return b.acceptIfWithinBookLimit(preparedImage{format: fmtInfo, data: data})
	}

	targetW, targetH := fitImageDimensions(cfg.Width, cfg.Height)
	needed := estimateDecodeBytes(fmtInfo, data, cfg, targetW, targetH)
	if !budget.acquire(ctx, needed) {
		return preparedImage{}
	}
	defer budget.release(needed)

	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return preparedImage{}
	}

	encoded, ok := encodeDownscaledJPEG(src, targetW, targetH)
	if ok && len(encoded) < len(data) {
		return b.acceptIfWithinBookLimit(preparedImage{format: jpegFormat, data: encoded})
	}

	return b.acceptIfWithinBookLimit(preparedImage{format: fmtInfo, data: data})
}

func (b *Builder) acceptIfWithinBookLimit(img preparedImage) preparedImage {
	if len(img.data) > b.maxEPUBBytes {
		return preparedImage{}
	}

	return img
}

func encodeDownscaledJPEG(src image.Image, targetW int, targetH int) ([]byte, bool) {
	dst := resampleOntoWhite(src, targetW, targetH)
	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, dst, &jpeg.Options{Quality: epubJPEGQuality}); err != nil {
		return nil, false
	}

	return encoded.Bytes(), true
}

func needsOptimization(cfg image.Config, byteLen int) bool {
	return cfg.Width > maxEPUBImageWidth || cfg.Height > maxEPUBImageHeight || byteLen > imageReencodeMinBytes
}

// estimateDecodeBytes is a conservative upper bound on the heap the standard
// library holds while decoding data, plus the downscaled RGBA target. Only the
// optimizable formats (PNG and JPEG) are ever decoded.
func estimateDecodeBytes(fmtInfo imageFormat, data []byte, cfg image.Config, dstW int, dstH int) int64 {
	pixels := int64(cfg.Width) * int64(cfg.Height)
	dstBytes := int64(dstW) * int64(dstH) * bytesPerRGBAPixel

	if fmtInfo.decodeName == jpegFormat.decodeName {
		return pixels*jpegBytesPerPixel(cfg.ColorModel, data) + dstBytes + jpegDecoderOverheadBytes
	}

	srcBPP := pngBytesPerPixel(cfg.ColorModel)

	// image/png also keeps two scanline filter buffers plus inflate window/reader state.
	return pixels*srcBPP + dstBytes + 2*(int64(cfg.Width)*srcBPP+1) + pngDecoderOverheadBytes
}

func pngBytesPerPixel(model color.Model) int64 {
	switch model {
	case color.RGBAModel, color.NRGBAModel, color.GrayModel:
		return bytesPerRGBAPixel
	default:
		if _, isPalette := model.(color.Palette); isPalette {
			return bytesPerRGBAPixel
		}

		// 16-bit PNGs (RGBA64/NRGBA64/Gray16) or unknown models decode to up to 8 bytes/pixel.
		return bytesPerRGBA64Pixel
	}
}

func jpegBytesPerPixel(model color.Model, data []byte) int64 {
	var components, imageBytes int64

	switch model {
	case color.GrayModel:
		components, imageBytes = 1, 1
	case color.YCbCrModel:
		components, imageBytes = 3, 3
	default:
		// CMYK/YCCK: a YCbCr image plus a black plane, then a CMYK copy.
		components, imageBytes = 4, 8
	}

	if jpegProgressive(data) {
		imageBytes += components * jpegCoefficientBytesPerPixel
	}

	return imageBytes
}

// jpegProgressive reports whether the first start-of-frame marker is a
// progressive one. Anything it cannot parse is treated as progressive so the
// estimate stays an upper bound.
func jpegProgressive(data []byte) bool {
	const (
		markerPrefix  = 0xff
		markerTEM     = 0x01
		markerRST0    = 0xd0
		markerSOI     = 0xd8
		markerSOF0    = 0xc0
		markerSOF1    = 0xc1
		markerSOF2    = 0xc2
		segmentHeader = 4
	)

	for i := 2; i+segmentHeader <= len(data); {
		if data[i] != markerPrefix {
			return true
		}

		marker := data[i+1]

		switch {
		case marker == markerPrefix:
			i++
		case marker == markerTEM || (marker >= markerRST0 && marker <= markerSOI):
			i += 2
		case marker == markerSOF0 || marker == markerSOF1:
			return false
		case marker == markerSOF2:
			return true
		default:
			i += 2 + (int(data[i+2])<<8 | int(data[i+3]))
		}
	}

	return true
}

func fitImageDimensions(width int, height int) (int, int) {
	targetW := width
	targetH := height

	if targetW > maxEPUBImageWidth {
		targetH = max(1, (targetH*maxEPUBImageWidth)/targetW)
		targetW = maxEPUBImageWidth
	}

	if targetH > maxEPUBImageHeight {
		targetW = max(1, (targetW*maxEPUBImageHeight)/targetH)
		targetH = maxEPUBImageHeight
	}

	return targetW, targetH
}

func resampleOntoWhite(src image.Image, dstW int, dstH int) *image.RGBA {
	bounds := src.Bounds()
	srcW := bounds.Dx()
	srcH := bounds.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, dstW, dstH))

	for y := range dstH {
		srcY := bounds.Min.Y + ((2*y+1)*srcH)/(2*dstH)
		rowOffset := y * dst.Stride

		for x := range dstW {
			srcX := bounds.Min.X + ((2*x+1)*srcW)/(2*dstW)
			r, g, b, a := src.At(srcX, srcY).RGBA()
			white := uint32(0xffff) - a
			pix := dst.Pix[rowOffset+x*4 : rowOffset+x*4+4]
			pix[0] = uint8((r + white) >> 8)
			pix[1] = uint8((g + white) >> 8)
			pix[2] = uint8((b + white) >> 8)
			pix[3] = 0xff
		}
	}

	return dst
}

func normalizeImageFormat(mediaType string, ext string) (imageFormat, bool) {
	cleanType := mediaType
	if separator := strings.IndexByte(cleanType, ';'); separator >= 0 {
		cleanType = cleanType[:separator]
	}

	switch strings.ToLower(strings.TrimSpace(cleanType)) {
	case "image/jpeg":
		return jpegFormat, true
	case "image/png":
		return pngFormat, true
	case "image/gif":
		return gifFormat, true
	case "":
		return imageFormatFromExt(ext)
	default:
		return imageFormat{}, false
	}
}

func imageFormatFromExt(ext string) (imageFormat, bool) {
	switch strings.ToLower(strings.TrimSpace(ext)) {
	case ".jpg", ".jpeg":
		return jpegFormat, true
	case ".png":
		return pngFormat, true
	case ".gif":
		return gifFormat, true
	default:
		return imageFormat{}, false
	}
}
