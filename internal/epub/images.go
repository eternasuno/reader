package epub

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	_ "image/png"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	maxEPUBImageWidth        = 1200
	maxEPUBImageHeight       = 1600
	imageReencodeMinBytes    = 128 << 10
	maxImageDecodeDimension  = 6144
	maxImageDecodePixels     = 12_000_000
	maxGIFFrames             = 128
	maxGIFDecodePixels       = 24_000_000
	bytesPerRGBAPixel        = 4
	bytesPerRGBA64Pixel      = 8
	pngDecoderOverheadBytes  = 512 << 10
	jpegDecoderOverheadBytes = 512 << 10
	gifDecoderOverheadBytes  = 512 << 10
	gifFrameOverheadBytes    = 1024
	gifHeaderBytes           = 13
	gifBlockExtension        = 0x21
	gifBlockImage            = 0x2c
	gifBlockTrailer          = 0x3b
	gifExtPlainText          = 0x01
	gifExtGraphicControl     = 0xf9
	gifExtComment            = 0xfe
	gifExtApplication        = 0xff
	// A progressive JPEG keeps one [64]int32 block (256 bytes) per 8x8 samples
	// of every component until the last scan, i.e. 4 bytes per component pixel.
	jpegCoefficientBytesPerPixel = 4
	epubJPEGQuality              = 75
	pngSignature                 = "\x89PNG\r\n\x1a\n"
	pngIHDRMinBytes              = 29
	pngIHDRTypeOffset            = 12
	pngIHDRInterlaceAt           = 28
	maxCachedFailedImages        = 4096
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

func (b *Builder) prepareChapterImages(
	ctx context.Context,
	deadline time.Time,
	urls []string,
	remainingBudget int64,
	failed map[string]struct{},
	prepared map[string]preparedImage,
) error {
	if b.imageFetcher == nil || remainingBudget <= 0 || !time.Now().Before(deadline) {
		return ctx.Err()
	}

	pending := collectPendingImageURLs(urls, failed, prepared)
	if len(pending) == 0 {
		return ctx.Err()
	}

	prepCtx, cancelPrep := context.WithDeadline(ctx, deadline)
	defer cancelPrep()

	results, attempted := b.fetchAndPrepareImages(prepCtx, pending, remainingBudget)
	if err := ctx.Err(); err != nil {
		return err
	}

	recordPreparedImages(pending, results, attempted, prepCtx.Err() == nil, failed, prepared)

	return nil
}

func collectPendingImageURLs(urls []string, failed map[string]struct{}, prepared map[string]preparedImage) []string {
	pending := make([]string, 0, len(urls))
	for _, rawURL := range urls {
		if _, isFailed := failed[rawURL]; isFailed {
			continue
		}
		if _, isPrepared := prepared[rawURL]; isPrepared {
			continue
		}

		pending = append(pending, rawURL)
	}

	return pending
}

func recordPreparedImages(
	urls []string,
	results []preparedImage,
	attempted []bool,
	prepCompleted bool,
	failed map[string]struct{},
	prepared map[string]preparedImage,
) {
	for i, rawURL := range urls {
		if results[i].valid() {
			prepared[rawURL] = results[i]
			continue
		}

		if attempted[i] && prepCompleted && len(failed) < maxCachedFailedImages {
			failed[rawURL] = struct{}{}
		}
	}
}

func (b *Builder) fetchAndPrepareImages(ctx context.Context, urls []string, byteBudget int64) ([]preparedImage, []bool) {
	results := make([]preparedImage, len(urls))
	attempted := make([]bool, len(urls))
	var nextIdx atomic.Int64
	var collectedBytes atomic.Int64

	budget := newDecodeBudget(b.decodeMemoryBudget)
	var waitGroup sync.WaitGroup
	for range min(b.imageConcurrency, len(urls)) {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			b.prepareImageWorker(ctx, urls, results, attempted, &nextIdx, &collectedBytes, byteBudget, budget)
		}()
	}

	waitGroup.Wait()

	return results, attempted
}

func (b *Builder) prepareImageWorker(
	ctx context.Context,
	urls []string,
	results []preparedImage,
	attempted []bool,
	nextIdx *atomic.Int64,
	collectedBytes *atomic.Int64,
	byteBudget int64,
	budget *decodeBudget,
) {
	for {
		if ctx.Err() != nil || collectedBytes.Load() >= byteBudget {
			return
		}

		idx := int(nextIdx.Add(1) - 1)
		if idx >= len(urls) {
			return
		}

		attempted[idx] = true
		img := b.prepareOneImage(ctx, urls[idx], budget)
		if !img.valid() {
			continue
		}

		if !tryReserveBookImageBytes(collectedBytes, byteBudget, int64(len(img.data))) {
			attempted[idx] = int64(len(img.data)) > b.maxBookImageBytes

			continue
		}

		results[idx] = img
	}
}

func tryReserveBookImageBytes(collectedBytes *atomic.Int64, byteBudget int64, size int64) bool {
	if size <= 0 || size > byteBudget {
		return false
	}

	for {
		cur := collectedBytes.Load()
		if cur > byteBudget || size > byteBudget-cur {
			return false
		}

		if collectedBytes.CompareAndSwap(cur, cur+size) {
			return true
		}
	}
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
	if !fmtInfo.optimizable {
		return b.validateGIFImage(ctx, data, fmtInfo, cfg, budget)
	}

	if !needsOptimization(cfg, len(data)) {
		needed := estimateDecodeBytes(fmtInfo, data, cfg, 0, 0)
		if _, ok := decodeWithBudget(ctx, budget, needed, data); !ok {
			return preparedImage{}
		}

		return b.acceptIfWithinBookLimit(preparedImage{format: fmtInfo, data: data})
	}

	targetW, targetH := fitImageDimensions(cfg.Width, cfg.Height)
	needed := estimateDecodeBytes(fmtInfo, data, cfg, targetW, targetH)
	src, ok := decodeWithBudget(ctx, budget, needed, data)
	if !ok {
		return preparedImage{}
	}

	encoded, ok := encodeDownscaledJPEG(src, targetW, targetH)
	if ok && len(encoded) < len(data) {
		return b.acceptIfWithinBookLimit(preparedImage{format: jpegFormat, data: encoded})
	}

	return b.acceptIfWithinBookLimit(preparedImage{format: fmtInfo, data: data})
}

func decodeWithBudget(ctx context.Context, budget *decodeBudget, needed int64, data []byte) (image.Image, bool) {
	if !budget.acquire(ctx, needed) {
		return nil, false
	}

	defer budget.release(needed)

	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, false
	}

	return src, true
}

func (b *Builder) validateGIFImage(ctx context.Context, data []byte, fmtInfo imageFormat, cfg image.Config, budget *decodeBudget) preparedImage {
	frames, totalPixels, ok := inspectGIF(data, cfg.Width, cfg.Height)
	if !ok {
		return preparedImage{}
	}

	needed := estimateGIFDecodeBytes(frames, totalPixels)
	if !budget.acquire(ctx, needed) {
		return preparedImage{}
	}

	defer budget.release(needed)

	decoded, err := gif.DecodeAll(bytes.NewReader(data))
	if err != nil || len(decoded.Image) == 0 {
		return preparedImage{}
	}

	return b.acceptIfWithinBookLimit(preparedImage{format: fmtInfo, data: data})
}

func estimateGIFDecodeBytes(frames int, totalPixels int64) int64 {
	return totalPixels + int64(frames)*gifFrameOverheadBytes + gifDecoderOverheadBytes
}

func inspectGIF(data []byte, screenW int, screenH int) (int, int64, bool) {
	pos, ok := skipGIFHeaderAndGlobalTable(data)
	if !ok {
		return 0, 0, false
	}

	var frames int
	var totalPixels int64

	for pos < len(data) {
		block := data[pos]
		pos++

		switch block {
		case gifBlockTrailer:
			return frames, totalPixels, frames > 0
		case gifBlockExtension:
			pos, ok = skipGIFExtension(data, pos)
		case gifBlockImage:
			var framePixels int64
			pos, framePixels, ok = inspectGIFFrame(data, pos, screenW, screenH)
			frames++
			totalPixels += framePixels
			if frames > maxGIFFrames || totalPixels > maxGIFDecodePixels {
				return 0, 0, false
			}
		default:
			return 0, 0, false
		}

		if !ok {
			return 0, 0, false
		}
	}

	return 0, 0, false
}

func skipGIFHeaderAndGlobalTable(data []byte) (int, bool) {
	if len(data) < gifHeaderBytes {
		return 0, false
	}

	pos := gifHeaderBytes
	if fields := data[10]; fields&0x80 != 0 {
		pos += 3 * (1 << (1 + uint(fields&0x07)))
	}

	if pos > len(data) {
		return 0, false
	}

	return pos, true
}

func skipGIFExtension(data []byte, pos int) (int, bool) {
	if pos >= len(data) {
		return 0, false
	}

	ext := data[pos]
	pos++

	switch ext {
	case gifExtGraphicControl:
		if pos+6 > len(data) || data[pos] != 4 || data[pos+5] != 0 {
			return 0, false
		}

		return pos + 6, true
	case gifExtPlainText:
		if pos+13 > len(data) {
			return 0, false
		}

		return skipGIFSubBlocks(data, pos+13)
	case gifExtApplication:
		return skipGIFApplicationExtension(data, pos)
	case gifExtComment:
		return skipGIFSubBlocks(data, pos)
	default:
		return 0, false
	}
}

func skipGIFApplicationExtension(data []byte, pos int) (int, bool) {
	if pos >= len(data) {
		return 0, false
	}

	appLen := int(data[pos])
	pos++
	if pos+appLen > len(data) {
		return 0, false
	}

	return skipGIFSubBlocks(data, pos+appLen)
}

func inspectGIFFrame(data []byte, pos int, screenW int, screenH int) (int, int64, bool) {
	if pos+9 > len(data) {
		return 0, 0, false
	}

	left := int(data[pos]) | int(data[pos+1])<<8
	top := int(data[pos+2]) | int(data[pos+3])<<8
	fw := int(data[pos+4]) | int(data[pos+5])<<8
	fh := int(data[pos+6]) | int(data[pos+7])<<8
	fields := data[pos+8]
	pos += 9

	if fw <= 0 || fh <= 0 || left+fw > screenW || top+fh > screenH {
		return 0, 0, false
	}

	if fields&0x80 != 0 {
		pos += 3 * (1 << (1 + uint(fields&0x07)))
	}

	if pos >= len(data) || data[pos] < 2 || data[pos] > 8 {
		return 0, 0, false
	}

	nextPos, ok := skipGIFSubBlocks(data, pos+1)

	return nextPos, int64(fw) * int64(fh), ok
}

func skipGIFSubBlocks(data []byte, pos int) (int, bool) {
	for pos < len(data) {
		blockLen := int(data[pos])
		pos++
		if blockLen == 0 {
			return pos, true
		}

		if pos+blockLen > len(data) {
			return 0, false
		}

		pos += blockLen
	}

	return 0, false
}

func (b *Builder) acceptIfWithinBookLimit(img preparedImage) preparedImage {
	if len(img.data) > b.maxEPUBBytes || (b.maxBookImageBytes > 0 && int64(len(img.data)) > b.maxBookImageBytes) {
		return preparedImage{}
	}

	return img
}

func encodeDownscaledJPEG(src image.Image, targetW int, targetH int) ([]byte, bool) {
	encodedSrc := src
	bounds := src.Bounds()
	if bounds.Dx() != targetW || bounds.Dy() != targetH || !imageIsOpaque(src) {
		encodedSrc = resampleOntoWhite(src, targetW, targetH)
	}

	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, encodedSrc, &jpeg.Options{Quality: epubJPEGQuality}); err != nil {
		return nil, false
	}

	return encoded.Bytes(), true
}

func imageIsOpaque(src image.Image) bool {
	type opaquer interface {
		Opaque() bool
	}

	if o, ok := src.(opaquer); ok {
		return o.Opaque()
	}

	return false
}

func needsOptimization(cfg image.Config, byteLen int) bool {
	return cfg.Width > maxEPUBImageWidth || cfg.Height > maxEPUBImageHeight || byteLen > imageReencodeMinBytes
}

// estimateDecodeBytes is a conservative upper bound on the heap the standard
// library holds while decoding PNG/JPEG data, plus the downscaled RGBA target
// when dstW/dstH are non-zero.
func estimateDecodeBytes(fmtInfo imageFormat, data []byte, cfg image.Config, dstW int, dstH int) int64 {
	pixels := int64(cfg.Width) * int64(cfg.Height)
	dstBytes := int64(dstW) * int64(dstH) * bytesPerRGBAPixel

	if fmtInfo.decodeName == jpegFormat.decodeName {
		return pixels*jpegBytesPerPixel(cfg.ColorModel, data) + dstBytes + jpegDecoderOverheadBytes
	}

	srcBPP := pngBytesPerPixel(cfg.ColorModel)
	srcPixels := pixels
	if pngInterlaced(data) {
		srcPixels += maxAdam7PassPixels(cfg.Width, cfg.Height)
	}

	// image/png also keeps two scanline filter buffers plus inflate window/reader state.
	return srcPixels*srcBPP + dstBytes + 2*(int64(cfg.Width)*srcBPP+1) + pngDecoderOverheadBytes
}

func pngInterlaced(data []byte) bool {
	if len(data) < pngIHDRMinBytes || string(data[:len(pngSignature)]) != pngSignature {
		return true
	}

	if string(data[pngIHDRTypeOffset:pngIHDRTypeOffset+4]) != "IHDR" {
		return true
	}

	return data[pngIHDRInterlaceAt] != 0
}

func maxAdam7PassPixels(width int, height int) int64 {
	type adam7Pass struct {
		xFactor, yFactor, xOffset, yOffset int
	}

	passes := [7]adam7Pass{
		{8, 8, 0, 0},
		{8, 8, 4, 0},
		{4, 8, 0, 4},
		{4, 4, 2, 0},
		{2, 4, 0, 2},
		{2, 2, 1, 0},
		{1, 2, 0, 1},
	}

	var maxPixels int64
	for _, p := range passes {
		pw := (width - p.xOffset + p.xFactor - 1) / p.xFactor
		ph := (height - p.yOffset + p.yFactor - 1) / p.yFactor
		if pw <= 0 || ph <= 0 {
			continue
		}

		if n := int64(pw) * int64(ph); n > maxPixels {
			maxPixels = n
		}
	}

	return maxPixels
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
			i = nextJPEGSegmentOffset(data, i)
		}
	}

	return true
}

func nextJPEGSegmentOffset(data []byte, offset int) int {
	segLen := int(data[offset+2])<<8 | int(data[offset+3])
	if segLen < 2 {
		return len(data)
	}

	return offset + 2 + segLen
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
