package epub

import (
	"archive/zip"
	"bytes"
	"compress/zlib"
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/xml"
	"errors"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"reader/internal/domain"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
)

type fakeImage struct {
	data      []byte
	mediaType string
}

type fakeImageFetcher struct {
	mu     sync.Mutex
	images map[string]fakeImage
	calls  map[string]int
}

func newFakeImageFetcher(images map[string]fakeImage) *fakeImageFetcher {
	return &fakeImageFetcher{images: images, calls: make(map[string]int)}
}

func (f *fakeImageFetcher) FetchImage(ctx context.Context, rawURL string) ([]byte, string, string, error) {
	f.mu.Lock()
	f.calls[rawURL]++
	image, ok := f.images[rawURL]
	f.mu.Unlock()

	if !ok {
		return nil, "", "", fmt.Errorf("fetch %s: 404 not found", rawURL)
	}

	return image.data, image.mediaType, "", nil
}

func (f *fakeImageFetcher) callCount(rawURL string) int {
	f.mu.Lock()
	defer f.mu.Unlock()

	return f.calls[rawURL]
}

func opaqueRGBA(width int, height int) *image.RGBA {
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	for i := range canvas.Pix {
		canvas.Pix[i] = 0xff
	}

	return canvas
}

func opaqueRGBA64(width int, height int) *image.RGBA64 {
	canvas := image.NewRGBA64(image.Rect(0, 0, width, height))
	for i := range canvas.Pix {
		canvas.Pix[i] = 0xff
	}

	return canvas
}

// progressiveTestJPEG relabels the frame header of a baseline JPEG as
// progressive; only its header is ever read, never its scan data.

func progressiveTestJPEG(t *testing.T, baseline []byte) []byte {
	t.Helper()

	index := bytes.Index(baseline, []byte{0xff, 0xc0})
	if index < 0 {
		t.Fatal("baseline JPEG has no SOF0 marker")
	}

	progressive := bytes.Clone(baseline)
	progressive[index+1] = 0xc2

	return progressive
}

type blockingImageFetcher struct {
	fastURL  string
	fastData []byte
	slowURL  string
	gate     <-chan struct{}
	calls    atomic.Int64
}

func (f *blockingImageFetcher) FetchImage(ctx context.Context, rawURL string) ([]byte, string, string, error) {
	f.calls.Add(1)

	if rawURL == f.fastURL {
		return f.fastData, "image/png", ".png", nil
	}

	select {
	case <-ctx.Done():
		return nil, "", "", ctx.Err()
	case <-f.gate:
		return f.fastData, "image/png", ".png", nil
	}
}

func encodeTestJPEG(t *testing.T, width int, height int) []byte {
	t.Helper()

	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, canvas, &jpeg.Options{Quality: 75}); err != nil {
		t.Fatalf("jpeg.Encode() error = %v", err)
	}

	return buf.Bytes()
}

func encodeTestGIF(t *testing.T, width int, height int) []byte {
	t.Helper()

	palette := color.Palette{color.Black, color.White}
	canvas := image.NewPaletted(image.Rect(0, 0, width, height), palette)
	var buf bytes.Buffer
	if err := gif.Encode(&buf, canvas, nil); err != nil {
		t.Fatalf("gif.Encode() error = %v", err)
	}

	return buf.Bytes()
}

func encodeTestPNG(t *testing.T, width int, height int) []byte {
	t.Helper()

	canvas := image.NewNRGBA(image.Rect(0, 0, width, height))
	if _, err := rand.Read(canvas.Pix); err != nil {
		t.Fatalf("rand.Read() error = %v", err)
	}

	var buf bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.NoCompression}
	if err := encoder.Encode(&buf, canvas); err != nil {
		t.Fatalf("png.Encode() error = %v", err)
	}

	return buf.Bytes()
}

func openArchive(t *testing.T, data []byte) *zip.Reader {
	t.Helper()

	reader, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("zip.NewReader() error = %v", err)
	}

	if len(reader.File) == 0 {
		t.Fatalf("zip archive is empty")
	}

	return reader
}

func entryByName(t *testing.T, reader *zip.Reader, name string) *zip.File {
	t.Helper()

	for _, file := range reader.File {
		if file.Name == name {
			return file
		}
	}

	t.Fatalf("zip entry %q not found", name)

	return nil
}

func entryBody(t *testing.T, file *zip.File) []byte {
	t.Helper()

	body, err := file.Open()
	if err != nil {
		t.Fatalf("open zip entry %q: %v", file.Name, err)
	}
	defer body.Close()

	data, err := io.ReadAll(body)
	if err != nil {
		t.Fatalf("read zip entry %q: %v", file.Name, err)
	}

	return data
}

func requireValidXML(t *testing.T, name string, data []byte) {
	t.Helper()

	decoder := xml.NewDecoder(bytes.NewReader(data))
	for {
		if _, err := decoder.Token(); err != nil {
			if errors.Is(err, io.EOF) {
				return
			}

			t.Fatalf("%s is not valid XML: %v", name, err)
		}
	}
}

func randomBytes(t *testing.T, size int) []byte {
	t.Helper()

	data := make([]byte, size)
	if _, err := rand.Read(data); err != nil {
		t.Fatalf("generate random bytes: %v", err)
	}

	return data
}

func randomText(t *testing.T, size int) string {
	t.Helper()

	const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

	raw := randomBytes(t, size)
	text := make([]byte, size)
	for i, b := range raw {
		text[i] = alphabet[int(b)%len(alphabet)]
	}

	return string(text)
}

func encodeTestInterlacedPNG(t *testing.T, width int, height int, sixteenBit bool) []byte {
	t.Helper()

	bitDepth := byte(8)
	bytesPerPixel := 4
	if sixteenBit {
		bitDepth = 16
		bytesPerPixel = 8
	}

	var ihdr [13]byte
	binary.BigEndian.PutUint32(ihdr[0:4], uint32(width))
	binary.BigEndian.PutUint32(ihdr[4:8], uint32(height))
	ihdr[8] = bitDepth
	ihdr[9] = 6 // truecolour with alpha (NRGBA / NRGBA64)
	ihdr[10] = 0
	ihdr[11] = 0
	ihdr[12] = 1 // Adam7

	var rawPixels bytes.Buffer
	passes := [7]struct{ xFactor, yFactor, xOffset, yOffset int }{
		{8, 8, 0, 0},
		{8, 8, 4, 0},
		{4, 8, 0, 4},
		{4, 4, 2, 0},
		{2, 4, 0, 2},
		{2, 2, 1, 0},
		{1, 2, 0, 1},
	}

	noise := make([]byte, width*bytesPerPixel)
	if _, err := rand.Read(noise); err != nil {
		t.Fatalf("rand.Read() error = %v", err)
	}

	for _, p := range passes {
		pw := (width - p.xOffset + p.xFactor - 1) / p.xFactor
		ph := (height - p.yOffset + p.yFactor - 1) / p.yFactor
		if pw <= 0 || ph <= 0 {
			continue
		}

		rowLen := pw * bytesPerPixel
		for range ph {
			rawPixels.WriteByte(0) // None filter
			rawPixels.Write(noise[:rowLen])
		}
	}

	var compressed bytes.Buffer
	zw, err := zlib.NewWriterLevel(&compressed, zlib.NoCompression)
	if err != nil {
		t.Fatalf("zlib.NewWriterLevel() error = %v", err)
	}
	if _, err := zw.Write(rawPixels.Bytes()); err != nil {
		t.Fatalf("zlib.Write() error = %v", err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zlib.Close() error = %v", err)
	}

	var out bytes.Buffer
	out.WriteString("\x89PNG\r\n\x1a\n")
	writePNGChunk(&out, "IHDR", ihdr[:])
	writePNGChunk(&out, "IDAT", compressed.Bytes())
	writePNGChunk(&out, "IEND", nil)

	return out.Bytes()
}

func writePNGChunk(out *bytes.Buffer, chunkType string, data []byte) {
	var lenBuf [4]byte
	binary.BigEndian.PutUint32(lenBuf[:], uint32(len(data)))
	out.Write(lenBuf[:])
	out.WriteString(chunkType)
	out.Write(data)

	crc := crc32.NewIEEE()
	_, _ = crc.Write([]byte(chunkType))
	_, _ = crc.Write(data)
	binary.BigEndian.PutUint32(lenBuf[:], crc.Sum32())
	out.Write(lenBuf[:])
}

func corruptImagePayload(valid []byte, keepPrefix int) []byte {
	out := slices.Clone(valid)
	if len(out) <= keepPrefix {
		return out
	}

	return out[:keepPrefix]
}

func corruptJPEGScanData(valid []byte) []byte {
	out := slices.Clone(valid)
	sosIdx := bytes.Index(out, []byte{0xff, 0xda})
	if sosIdx < 0 || sosIdx+4 >= len(out) {
		return out
	}

	// Truncate right after SOS marker so DecodeConfig succeeds on SOF0 while Decode fails.
	return out[:sosIdx+4]
}

func encodeAnimatedTestGIF(t *testing.T, width int, height int, frames int) []byte {
	t.Helper()

	palette := color.Palette{color.Black, color.White}
	anim := &gif.GIF{
		Image: make([]*image.Paletted, frames),
		Delay: make([]int, frames),
	}

	for i := range frames {
		frame := image.NewPaletted(image.Rect(0, 0, width, height), palette)
		frame.Pix[0] = byte(i % len(palette))
		anim.Image[i] = frame
		anim.Delay[i] = 5
	}

	var buf bytes.Buffer
	if err := gif.EncodeAll(&buf, anim); err != nil {
		t.Fatalf("gif.EncodeAll() error = %v", err)
	}

	return buf.Bytes()
}

func corruptGIFData(valid []byte) []byte {
	out := slices.Clone(valid)
	idx := bytes.IndexByte(out, gifBlockImage)
	if idx < 0 || idx+12 >= len(out) {
		return out
	}

	// Truncate right after LZW min-code-size byte so DecodeConfig passes but DecodeAll fails.
	return out[:idx+11]
}

func outOfBoundsGIFFrame(valid []byte) []byte {
	out := slices.Clone(valid)
	idx := bytes.IndexByte(out, gifBlockImage)
	if idx < 0 || idx+10 >= len(out) {
		return out
	}

	// Set frame left=10, width=10 inside a 16x16 logical screen.
	binary.LittleEndian.PutUint16(out[idx+1:idx+3], 10)
	binary.LittleEndian.PutUint16(out[idx+5:idx+7], 10)

	return out
}

func encodeLargeGrayPNG(t *testing.T, width int, height int) []byte {
	t.Helper()

	canvas := image.NewGray(image.Rect(0, 0, width, height))
	for y := range height {
		rowOffset := y * canvas.Stride
		for x := range width {
			canvas.Pix[rowOffset+x] = uint8((x + y) & 0xff)
		}
	}

	var buf bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.NoCompression}
	if err := encoder.Encode(&buf, canvas); err != nil {
		t.Fatalf("png.Encode() error = %v", err)
	}

	return buf.Bytes()
}

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
