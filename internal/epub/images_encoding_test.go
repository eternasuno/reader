package epub

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"reader/internal/domain"
	"testing"
)

func TestEncodeDownscaledJPEGSkipsResamplingForOpaqueInBoundsImage(t *testing.T) {
	t.Parallel()

	grayPNG := encodeLargeGrayPNG(t, 800, 600)
	if len(grayPNG) <= imageReencodeMinBytes {
		t.Fatalf("grayPNG len = %d, want > %d", len(grayPNG), imageReencodeMinBytes)
	}

	fetcher := newFakeImageFetcher(map[string]fakeImage{
		"https://example.com/gray.png": {data: grayPNG, mediaType: "image/png"},
	})

	books, err := NewBuilder(Config{ImageFetcher: fetcher}).BuildBooks(context.Background(), "2026-03-15", []domain.KindleArticle{{
		ID:       "a-1",
		URL:      "https://example.com/posts/1",
		Title:    "免重采样",
		HTMLBody: `<img src="https://example.com/gray.png">`,
	}})
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	reader := openArchive(t, books[0].Data)
	jpgBytes := entryBody(t, entryByName(t, reader, "OEBPS/images/img-0001.jpg"))
	cfg, format, err := image.DecodeConfig(bytes.NewReader(jpgBytes))
	if err != nil {
		t.Fatalf("DecodeConfig() error = %v", err)
	}

	// Resampling into image.RGBA would convert Gray into YCbCr; fast path preserves GrayModel.
	if format != "jpeg" || cfg.Width != 800 || cfg.Height != 600 || cfg.ColorModel != color.GrayModel {
		t.Fatalf("got format=%q %dx%d model=%v, want jpeg 800x600 GrayModel", format, cfg.Width, cfg.Height, cfg.ColorModel)
	}
}

func TestEncodeDownscaledJPEGCompositesTransparentInBoundsImageOntoWhite(t *testing.T) {
	t.Parallel()

	canvas := image.NewNRGBA(image.Rect(0, 0, 16, 16))
	encoded, ok := encodeDownscaledJPEG(canvas, 16, 16)
	if !ok {
		t.Fatal("encodeDownscaledJPEG() returned false")
	}

	decoded, err := jpeg.Decode(bytes.NewReader(encoded))
	if err != nil {
		t.Fatalf("jpeg.Decode() error = %v", err)
	}

	r, g, b, _ := decoded.At(8, 8).RGBA()
	if r>>8 < 250 || g>>8 < 250 || b>>8 < 250 {
		t.Fatalf("transparent pixel composited to (%d, %d, %d), want near white", r>>8, g>>8, b>>8)
	}
}
