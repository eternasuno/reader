package epub

import (
	"bytes"
	"context"
	"crypto/rand"
	"image"
	"image/color"
	"image/png"
	"reader/internal/domain"
	"strings"
	"testing"
	"time"
)

func TestDecodeBudgetBoundsConcurrentDecodes(t *testing.T) {
	t.Parallel()

	budget := newDecodeBudget(20 << 20)
	if budget.acquire(context.Background(), 25<<20) {
		t.Fatal("expected acquire exceeding limit to return false")
	}

	if !budget.acquire(context.Background(), 12<<20) {
		t.Fatal("expected first acquire to succeed")
	}

	secondDone := make(chan bool, 1)
	go func() {
		secondDone <- budget.acquire(context.Background(), 12<<20)
	}()

	select {
	case got := <-secondDone:
		t.Fatalf("second acquire returned %v before first released", got)
	case <-time.After(20 * time.Millisecond):
	}

	budget.release(12 << 20)

	select {
	case got := <-secondDone:
		if !got {
			t.Fatal("second acquire returned false after release")
		}
	case <-time.After(time.Second):
		t.Fatal("second acquire did not wake after release")
	}
}

func TestEstimateDecodeBytesChargesSixteenBitPNGAtEightBytesPerPixel(t *testing.T) {
	t.Parallel()

	const side = 1000

	pixels := int64(side) * int64(side)
	dstBytes := pixels * bytesPerRGBAPixel

	tests := []struct {
		name      string
		canvas    image.Image
		wantBPP   int64
		wantModel color.Model
	}{
		{name: "NRGBA 8-bit", canvas: image.NewNRGBA(image.Rect(0, 0, side, side)), wantBPP: 4, wantModel: color.NRGBAModel},
		{name: "RGBA 8-bit", canvas: opaqueRGBA(side, side), wantBPP: 4, wantModel: color.RGBAModel},
		{name: "Gray 8-bit", canvas: image.NewGray(image.Rect(0, 0, side, side)), wantBPP: 4, wantModel: color.GrayModel},
		{name: "NRGBA 16-bit", canvas: image.NewNRGBA64(image.Rect(0, 0, side, side)), wantBPP: 8, wantModel: color.NRGBA64Model},
		{name: "RGBA 16-bit", canvas: opaqueRGBA64(side, side), wantBPP: 8, wantModel: color.RGBA64Model},
		{name: "Gray 16-bit", canvas: image.NewGray16(image.Rect(0, 0, side, side)), wantBPP: 8, wantModel: color.Gray16Model},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			var buf bytes.Buffer
			if err := png.Encode(&buf, tt.canvas); err != nil {
				t.Fatalf("png.Encode() error = %v", err)
			}

			cfg, valid := validateImageConfig(buf.Bytes(), pngFormat)
			if !valid {
				t.Fatal("validateImageConfig() rejected a valid PNG")
			}

			if cfg.ColorModel != tt.wantModel {
				t.Fatalf("DecodeConfig color model = %v, want %v", cfg.ColorModel, tt.wantModel)
			}

			got := estimateDecodeBytes(pngFormat, buf.Bytes(), cfg, side, side)
			if minimum := pixels*tt.wantBPP + dstBytes; got < minimum {
				t.Fatalf("estimateDecodeBytes() = %d, want at least %d (%d bytes/pixel source plus target)", got, minimum, tt.wantBPP)
			}

			if expected := pixels*tt.wantBPP + dstBytes + pngDecoderOverheadBytes + 2*(side*tt.wantBPP+1); got != expected {
				t.Fatalf("estimateDecodeBytes() = %d, want %d including decoder workspace", got, expected)
			}
		})
	}
}

func TestEstimateDecodeBytesChargesProgressiveJPEGCoefficients(t *testing.T) {
	t.Parallel()

	const side = 1000

	baseline := encodeTestJPEG(t, side, side)
	progressive := progressiveTestJPEG(t, baseline)

	cfg, valid := validateImageConfig(baseline, jpegFormat)
	if !valid {
		t.Fatal("validateImageConfig() rejected a valid JPEG")
	}

	progressiveCfg, valid := validateImageConfig(progressive, jpegFormat)
	if !valid {
		t.Fatal("validateImageConfig() rejected a progressive JPEG header")
	}

	pixels := int64(side) * int64(side)
	baselineBytes := estimateDecodeBytes(jpegFormat, baseline, cfg, side, side)
	progressiveBytes := estimateDecodeBytes(jpegFormat, progressive, progressiveCfg, side, side)

	// Three components keep 4 bytes per pixel each in coefficient blocks.
	if want := baselineBytes + 3*jpegCoefficientBytesPerPixel*pixels; progressiveBytes != want {
		t.Fatalf("progressive estimate = %d, want baseline %d plus coefficient blocks = %d", progressiveBytes, baselineBytes, want)
	}

	if baselineBytes < pixels*3 {
		t.Fatalf("baseline estimate = %d, want at least 3 bytes per pixel", baselineBytes)
	}
}

func TestJPEGProgressiveDetection(t *testing.T) {
	t.Parallel()

	baseline := encodeTestJPEG(t, 16, 16)

	tests := []struct {
		name string
		data []byte
		want bool
	}{
		{name: "baseline encoder output", data: baseline, want: false},
		{name: "progressive SOF2", data: progressiveTestJPEG(t, baseline), want: true},
		{name: "baseline SOF0 after a skipped segment and fill bytes", data: []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xff, 0xff, 0xc0, 0x00, 0x00}, want: false},
		{name: "extended sequential SOF1", data: []byte{0xff, 0xd8, 0xff, 0xc1, 0x00, 0x00}, want: false},
		{name: "progressive SOF2 after a skipped segment", data: []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc2, 0x00, 0x00}, want: true},
		{name: "unparsable bytes count as progressive", data: []byte{0xff, 0xd8, 0x00, 0x00, 0x00, 0x00}, want: true},
		{name: "no frame header counts as progressive", data: []byte{0xff, 0xd8, 0xff, 0xd9}, want: true},
		{name: "malformed segment length", data: []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x00}, want: true},
		{name: "empty input counts as progressive", data: nil, want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := jpegProgressive(tt.data); got != tt.want {
				t.Fatalf("jpegProgressive() = %v, want %v", got, tt.want)
			}
		})
	}
}

// opaqueRGBA and opaqueRGBA64 are fully opaque so the PNG encoder emits
// truecolor without alpha, which decodes to the RGBA models.

func TestEstimateDecodeBytesChargesInterlacedPNGAdam7Pass(t *testing.T) {
	t.Parallel()

	if got := maxAdam7PassPixels(1, 1); got != 1 {
		t.Fatalf("maxAdam7PassPixels(1, 1) = %d, want 1", got)
	}
	if got := maxAdam7PassPixels(9, 1); got != 4 {
		t.Fatalf("maxAdam7PassPixels(9, 1) = %d, want 4", got)
	}
	if got := maxAdam7PassPixels(1000, 1000); got != 500_000 {
		t.Fatalf("maxAdam7PassPixels(1000, 1000) = %d, want 500000", got)
	}

	const side = 1000
	pixels := int64(side) * int64(side)
	passPixels := maxAdam7PassPixels(side, side)
	dstBytes := pixels * bytesPerRGBAPixel

	tests := []struct {
		name       string
		sixteenBit bool
		wantBPP    int64
	}{
		{name: "interlaced full-colour 8-bit", sixteenBit: false, wantBPP: 4},
		{name: "interlaced full-colour 16-bit", sixteenBit: true, wantBPP: 8},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			data := encodeTestInterlacedPNG(t, side, side, tt.sixteenBit)
			if !pngInterlaced(data) {
				t.Fatal("pngInterlaced() = false, want true")
			}

			cfg, valid := validateImageConfig(data, pngFormat)
			if !valid {
				t.Fatal("validateImageConfig() rejected interlaced PNG")
			}

			if _, err := png.Decode(bytes.NewReader(data)); err != nil {
				t.Fatalf("png.Decode() failed on interlaced fixture: %v", err)
			}

			got := estimateDecodeBytes(pngFormat, data, cfg, side, side)
			want := (pixels+passPixels)*tt.wantBPP + dstBytes + 2*(int64(side)*tt.wantBPP+1) + pngDecoderOverheadBytes
			if got != want {
				t.Fatalf("estimateDecodeBytes() = %d, want %d", got, want)
			}
		})
	}
}

func TestBuildBooksChargesInterlacedPNGAgainstDecodeBudget(t *testing.T) {
	t.Parallel()
	const side = 1000
	eight := image.NewNRGBA(image.Rect(0, 0, side, side))
	sixteen := image.NewNRGBA64(image.Rect(0, 0, side, side))
	for _, pix := range [][]byte{eight.Pix, sixteen.Pix} {
		if _, err := rand.Read(pix); err != nil {
			t.Fatal(err)
		}
	}
	encode := func(img image.Image) []byte {
		var buf bytes.Buffer
		if err := (&png.Encoder{CompressionLevel: png.NoCompression}).Encode(&buf, img); err != nil {
			t.Fatal(err)
		}
		return buf.Bytes()
	}
	plain8 := encode(eight)
	plain16 := encode(sixteen)
	inter8 := encodeTestInterlacedPNG(t, side, side, false)
	inter16 := encodeTestInterlacedPNG(t, side, side, true)
	imgs := map[string][]byte{"plain8": plain8, "plain16": plain16, "inter8": inter8, "inter16": inter16}
	for name, data := range imgs {
		if len(data) <= imageReencodeMinBytes {
			t.Fatalf("%s len = %d, want > %d", name, len(data), imageReencodeMinBytes)
		}
	}
	tests := []struct {
		name    string
		budget  int64
		sources []string
		kept    []string
	}{
		{"plain sixteen bit", 10 << 20, []string{"plain8", "plain16"}, []string{"plain8"}},
		{"9.5 MB", 9_500_000, []string{"plain8", "inter8", "inter16"}, []string{"plain8"}},
		{"15 MiB", 15 << 20, []string{"plain8", "inter8", "inter16"}, []string{"plain8", "inter8"}},
		{"18 MiB", 18 << 20, []string{"plain8", "inter8", "inter16"}, []string{"plain8", "inter8", "inter16"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fetch := map[string]fakeImage{}
			var body strings.Builder
			for _, name := range tt.sources {
				url := "https://example.com/" + name + ".png"
				fetch[url] = fakeImage{data: imgs[name], mediaType: "image/png"}
				body.WriteString(`<img alt="` + name + `" src="` + url + `">`)
			}
			books, err := newTestBuilder(Config{ImageFetcher: newFakeImageFetcher(fetch), ImageDecodeMemoryBudget: tt.budget}).BuildBooks(context.Background(), "2026-03-15", []domain.KindleArticle{{ID: "article-1", URL: "https://example.com/posts/1", Title: "位深", HTMLBody: body.String()}})
			if err != nil {
				t.Fatalf("BuildBooks() error = %v", err)
			}
			chapter := string(entryBody(t, entryByName(t, openArchive(t, books[0].Data), "OEBPS/chapters/chapter-0001.xhtml")))
			if strings.Count(chapter, "<img") != len(tt.kept) {
				t.Fatalf("unexpected images: %s", chapter)
			}
			for _, name := range tt.sources {
				want := false
				for _, kept := range tt.kept {
					if kept == name {
						want = true
					}
				}
				if strings.Contains(chapter, `alt="`+name+`"`) != want {
					t.Fatalf("image %s presence = %v, want %v: %s", name, !want, want, chapter)
				}
			}
		})
	}
}

func TestBuildBooksRejectsSmallJPEGExceedingDecodeBudget(t *testing.T) {
	t.Parallel()

	// 800x800 baseline YCbCr JPEG needs ~2.4 MiB decode memory (800*800*3 + 512 KiB)
	// even though the compressed file is small (<= 128 KiB).
	smallFileBigDecodeJPG := encodeTestJPEG(t, 800, 800)
	if len(smallFileBigDecodeJPG) > imageReencodeMinBytes {
		t.Fatalf("test JPEG len = %d, want <= %d", len(smallFileBigDecodeJPG), imageReencodeMinBytes)
	}

	tinyPNG := encodeTestPNG(t, 16, 16)
	fetcher := newFakeImageFetcher(map[string]fakeImage{
		"https://example.com/big-decode.jpg": {data: smallFileBigDecodeJPG, mediaType: "image/jpeg"},
		"https://example.com/tiny.png":       {data: tinyPNG, mediaType: "image/png"},
	})

	articles := []domain.KindleArticle{{
		ID:       "article-1",
		URL:      "https://example.com/posts/1",
		Title:    "小图解码预算",
		HTMLBody: `<p>正文</p><img src="https://example.com/big-decode.jpg"><img src="https://example.com/tiny.png">`,
	}}

	books, err := newTestBuilder(Config{
		ImageFetcher:            fetcher,
		ImageDecodeMemoryBudget: 1 << 20,
	}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	reader := openArchive(t, books[0].Data)
	chapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0001.xhtml")))
	if strings.Count(chapter, "<img") != 1 || !strings.Contains(chapter, `src="../images/img-0001.png"`) {
		t.Fatalf("expected only tiny.png embedded within 1 MiB decode budget, got:\n%s", chapter)
	}
}
