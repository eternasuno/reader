package epub

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"hash/crc32"
	"image"
	"reader/internal/domain"
	"strings"
	"testing"
	"time"
)

func TestBuildBooksEmbedsSupportedImagesAndStripsOthers(t *testing.T) {
	t.Parallel()

	pngData := encodeTestPNG(t, 16, 16)
	jpgData := encodeTestJPEG(t, 16, 16)
	gifData := encodeTestGIF(t, 16, 16)
	fetcher := newFakeImageFetcher(map[string]fakeImage{
		"https://example.com/a.png":  {data: pngData, mediaType: "image/png"},
		"https://example.com/b.jpg":  {data: jpgData, mediaType: "image/jpeg"},
		"https://example.com/c.gif":  {data: gifData, mediaType: "image/gif"},
		"https://example.com/d.webp": {data: []byte("webp-bytes"), mediaType: "image/webp"},
		"https://example.com/e.svg":  {data: []byte("<svg/>"), mediaType: "image/svg+xml"},
		"https://example.com/f.jpg":  {data: jpgData, mediaType: "image/jpeg; charset=binary"},
	})

	articles := []domain.KindleArticle{
		{
			ID:          "saved-1",
			IsSavedPage: true,
			SourceTitle: "稍后阅读",
			URL:         "https://example.com/posts/1",
			Title:       "带图文章",
			HTMLBody: strings.Join([]string{
				`<p>before</p>`,
				`<img src="https://example.com/a.png">`,
				`<img src="https://example.com/missing.png">`,
				`<img src="/b.jpg">`,
				`<img src="https://example.com/d.webp">`,
				`<img src="https://example.com/a.png">`,
				`<img src="https://example.com/e.svg">`,
				`<img src="https://example.com/f.jpg">`,
				`<img>`,
				`<p>after</p>`,
			}, ""),
		},
		{
			ID:          "item-1",
			SourceTitle: "示例订阅源",
			URL:         "https://example.com/posts/2",
			Title:       "第二篇",
			HTMLBody:    `<p>gif</p><img src="https://example.com/c.gif">`,
		},
	}

	books, err := newTestBuilder(Config{ImageFetcher: fetcher, ImageConcurrency: 2}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	if len(books) != 1 {
		t.Fatalf("BuildBooks() returned %d books, want 1", len(books))
	}

	if calls := fetcher.callCount("https://example.com/a.png"); calls != 1 {
		t.Fatalf("a.png fetched %d times, want 1", calls)
	}

	reader := openArchive(t, books[0].Data)
	embeddedImages := map[string][]byte{
		"OEBPS/images/img-0001.png": pngData,
		"OEBPS/images/img-0002.jpg": jpgData,
		"OEBPS/images/img-0003.jpg": jpgData,
		"OEBPS/images/img-0004.gif": gifData,
	}
	for name, want := range embeddedImages {
		if body := entryBody(t, entryByName(t, reader, name)); !bytes.Equal(body, want) {
			t.Fatalf("zip entry %q body = %q, want %q", name, body, want)
		}
	}

	firstChapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0001.xhtml")))
	requireValidXML(t, "OEBPS/chapters/chapter-0001.xhtml", []byte(firstChapter))

	if got := strings.Count(firstChapter, `src="../images/img-0001.png"`); got != 2 {
		t.Fatalf("chapter-0001 rewritten png images = %d, want 2:\n%s", got, firstChapter)
	}

	for _, want := range []string{`src="../images/img-0002.jpg"`, `src="../images/img-0003.jpg"`, `before`, `after`} {
		if !strings.Contains(firstChapter, want) {
			t.Fatalf("chapter-0001 missing %q:\n%s", want, firstChapter)
		}
	}

	for _, unwanted := range []string{"missing.png", "d.webp", "e.svg", "webp-bytes"} {
		if strings.Contains(firstChapter, unwanted) {
			t.Fatalf("chapter-0001 still references stripped image %q:\n%s", unwanted, firstChapter)
		}
	}

	secondChapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0002.xhtml")))
	if !strings.Contains(secondChapter, `src="../images/img-0004.gif"`) {
		t.Fatalf("chapter-0002 missing rewritten gif:\n%s", secondChapter)
	}

	opf := string(entryBody(t, entryByName(t, reader, "OEBPS/content.opf")))
	requireValidXML(t, "OEBPS/content.opf", []byte(opf))

	manifestImages := []string{
		`<item id="img-0001" href="images/img-0001.png" media-type="image/png"/>`,
		`<item id="img-0002" href="images/img-0002.jpg" media-type="image/jpeg"/>`,
		`<item id="img-0003" href="images/img-0003.jpg" media-type="image/jpeg"/>`,
		`<item id="img-0004" href="images/img-0004.gif" media-type="image/gif"/>`,
	}
	for _, want := range manifestImages {
		if !strings.Contains(opf, want) {
			t.Fatalf("content.opf missing manifest item %q:\n%s", want, opf)
		}
	}

	if got := strings.Count(opf, `<item id="img-`); got != len(manifestImages) {
		t.Fatalf("content.opf image manifest items = %d, want %d:\n%s", got, len(manifestImages), opf)
	}

	entries := make([]string, len(reader.File))
	for i, file := range reader.File {
		entries[i] = file.Name
	}

	for _, name := range entries {
		if !strings.HasPrefix(name, "OEBPS/images/img-") {
			continue
		}

		if _, ok := embeddedImages[name]; !ok {
			t.Fatalf("unexpected image entry %q in zip", name)
		}
	}
}

func TestBuildBooksStripsImagesWithoutFetcher(t *testing.T) {
	t.Parallel()

	articles := []domain.KindleArticle{{
		ID:          "saved-1",
		IsSavedPage: true,
		SourceTitle: "稍后阅读",
		URL:         "https://example.com/posts/1",
		Title:       "无图片下载器",
		HTMLBody:    `<p>before</p><img src="https://example.com/a.png"><p>after</p>`,
	}}

	books, err := newTestBuilder(Config{}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	reader := openArchive(t, books[0].Data)
	chapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0001.xhtml")))
	if strings.Contains(chapter, "<img") {
		t.Fatalf("chapter without image fetcher still contains an img element:\n%s", chapter)
	}

	for _, want := range []string{"<p>before</p>", "<p>after</p>"} {
		if !strings.Contains(chapter, want) {
			t.Fatalf("chapter missing %q:\n%s", want, chapter)
		}
	}
}

func TestBuildBooksRetriesTextOnlyForOversizedImage(t *testing.T) {
	t.Parallel()

	const maxBytes = 64 * 1024

	// Each 95x95 uncompressed PNG is ~36 KiB (<= 128 KiB, <= 1200x1600), so
	// both keep original size and together exceed maxBytes.
	fetcher := newFakeImageFetcher(map[string]fakeImage{
		"https://example.com/huge-1.png": {data: encodeTestPNG(t, 95, 95), mediaType: "image/png"},
		"https://example.com/huge-2.png": {data: encodeTestPNG(t, 95, 95), mediaType: "image/png"},
	})
	articles := []domain.KindleArticle{{
		ID:          "saved-1",
		IsSavedPage: true,
		SourceTitle: "稍后阅读",
		URL:         "https://example.com/posts/1",
		Title:       "大图文章",
		HTMLBody:    `<p>before</p><img src="https://example.com/huge-1.png"><img src="https://example.com/huge-2.png"><p>after</p>`,
	}}

	books, err := newTestBuilder(Config{ImageFetcher: fetcher, MaxEPUBBytes: maxBytes}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	if len(books) != 1 {
		t.Fatalf("BuildBooks() returned %d books, want 1", len(books))
	}

	book := books[0]
	if book.Title != "Lantern 2026-03-15" {
		t.Fatalf("Title = %q, want %q", book.Title, "Lantern 2026-03-15")
	}

	if book.Filename != "lantern-2026-03-15.epub" {
		t.Fatalf("Filename = %q, want %q", book.Filename, "lantern-2026-03-15.epub")
	}

	if len(book.Data) > maxBytes {
		t.Fatalf("text-only book is %d bytes, want at most %d", len(book.Data), maxBytes)
	}

	reader := openArchive(t, book.Data)
	for _, file := range reader.File {
		if strings.HasPrefix(file.Name, "OEBPS/images/img-") {
			t.Fatalf("text-only book still embeds %q", file.Name)
		}
	}

	chapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0001.xhtml")))
	requireValidXML(t, "OEBPS/chapters/chapter-0001.xhtml", []byte(chapter))

	if strings.Contains(chapter, "<img") {
		t.Fatalf("text-only chapter still contains an img element:\n%s", chapter)
	}

	for _, want := range []string{"<p>before</p>", "<p>after</p>"} {
		if !strings.Contains(chapter, want) {
			t.Fatalf("text-only chapter missing %q:\n%s", want, chapter)
		}
	}

	opf := string(entryBody(t, entryByName(t, reader, "OEBPS/content.opf")))
	if strings.Contains(opf, `id="img-`) {
		t.Fatalf("text-only content.opf still lists images:\n%s", opf)
	}
}

func TestBuildBooksFetchesFailedImageOnceAcrossSplits(t *testing.T) {
	t.Parallel()

	const (
		articleBytes = 100 * 1024
		maxBytes     = 200 * 1024
		failingURL   = "https://example.com/missing.png"
		okURL        = "https://example.com/ok.png"
	)

	fetcher := newFakeImageFetcher(map[string]fakeImage{
		okURL: {data: encodeTestPNG(t, 16, 16), mediaType: "image/png"},
	})

	articles := make([]domain.KindleArticle, 4)
	for i := range articles {
		htmlBody := "<p>" + randomText(t, articleBytes) + "</p>"
		if i == 0 || i == 2 {
			htmlBody += `<img src="` + failingURL + `">`
		}

		if i == 1 {
			htmlBody += `<img src="` + okURL + `">`
		}

		articles[i] = domain.KindleArticle{
			ID:       fmt.Sprintf("article-%d", i+1),
			URL:      fmt.Sprintf("https://example.com/posts/%d", i+1),
			Title:    fmt.Sprintf("第%d篇", i+1),
			HTMLBody: htmlBody,
		}
	}

	books, err := newTestBuilder(Config{ImageFetcher: fetcher, MaxEPUBBytes: maxBytes}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	if len(books) != 2 {
		t.Fatalf("BuildBooks() returned %d books, want 2", len(books))
	}

	if calls := fetcher.callCount(failingURL); calls != 1 {
		t.Fatalf("%s fetched %d times, want 1", failingURL, calls)
	}

	if calls := fetcher.callCount(okURL); calls != 1 {
		t.Fatalf("%s fetched %d times, want 1", okURL, calls)
	}

	for i, book := range books {
		if len(book.Data) > maxBytes {
			t.Fatalf("books[%d] is %d bytes, want at most %d", i, len(book.Data), maxBytes)
		}
	}
}

func TestBuildBooksRejectsOversizedSingleImageInFirstDraft(t *testing.T) {
	t.Parallel()

	const (
		maxBytes = 32 * 1024
		bigURL   = "https://example.com/huge.png"
	)

	bigImage := encodeTestPNG(t, 140, 140)
	fetcher := newFakeImageFetcher(map[string]fakeImage{
		bigURL: {data: bigImage, mediaType: "image/png"},
	})

	articles := []domain.KindleArticle{
		{
			ID:       "article-1",
			URL:      "https://example.com/posts/1",
			Title:    "第一篇",
			HTMLBody: `<p>正文</p><img src="` + bigURL + `">`,
		},
	}

	books, err := newTestBuilder(Config{ImageFetcher: fetcher, MaxEPUBBytes: maxBytes}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	if len(books) != 1 {
		t.Fatalf("got %d books, want 1", len(books))
	}

	if calls := fetcher.callCount(bigURL); calls != 1 {
		t.Fatalf("bigURL fetched %d times, want 1", calls)
	}

	reader := openArchive(t, books[0].Data)
	chapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0001.xhtml")))
	if strings.Contains(chapter, "<img") {
		t.Fatalf("expected oversized image to be stripped in first draft, got:\n%s", chapter)
	}
}

func TestBuildBooksDownscalesAndCompressesLargeImages(t *testing.T) {
	t.Parallel()

	rawPNG := encodeTestPNG(t, 2400, 1800)
	fetcher := newFakeImageFetcher(map[string]fakeImage{
		"https://example.com/photo.png": {data: rawPNG, mediaType: "image/png"},
	})
	articles := []domain.KindleArticle{{
		ID:       "article-1",
		URL:      "https://example.com/posts/1",
		Title:    "高清大图",
		HTMLBody: `<p>正文</p><img src="https://example.com/photo.png">`,
	}}

	books, err := newTestBuilder(Config{ImageFetcher: fetcher}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	reader := openArchive(t, books[0].Data)
	jpgBytes := entryBody(t, entryByName(t, reader, "OEBPS/images/img-0001.jpg"))
	if len(jpgBytes) >= len(rawPNG) {
		t.Fatalf("compressed image size = %d, want smaller than raw PNG %d", len(jpgBytes), len(rawPNG))
	}

	cfg, format, err := image.DecodeConfig(bytes.NewReader(jpgBytes))
	if err != nil {
		t.Fatalf("DecodeConfig() error = %v", err)
	}

	if format != "jpeg" || cfg.Width != 1200 || cfg.Height != 900 {
		t.Fatalf("decoded format=%q size=%dx%d, want jpeg 1200x900", format, cfg.Width, cfg.Height)
	}
}

func TestBuildBooksStripsMalformedAndOverDimensionImages(t *testing.T) {
	t.Parallel()
	overDim := encodeTestPNG(t, 16, 16)
	binary.BigEndian.PutUint32(overDim[16:20], 7000)
	binary.BigEndian.PutUint32(overDim[29:33], crc32.ChecksumIEEE(overDim[12:29]))
	cfg, _, err := image.DecodeConfig(bytes.NewReader(overDim))
	if err != nil || cfg.Width != 7000 {
		t.Fatalf("over-dimension PNG DecodeConfig = %+v, %v", cfg, err)
	}
	corruptPNG := corruptImagePayload(encodeTestPNG(t, 16, 16), 33)
	corruptJPG := corruptJPEGScanData(encodeTestJPEG(t, 16, 16))
	tests := []struct {
		name, media string
		data        []byte
		validHeader bool
	}{
		{"invalid PNG header", "image/png", []byte("\x89PNG\r\n\x1a\nnot-a-png"), false},
		{"invalid JPEG header", "image/jpeg", []byte("\xff\xd8\xffnot-a-jpg"), false},
		{"unsized GIF", "image/gif", []byte("GIF89a\x00\x00\x00\x00\x00\x00\x00;"), false},
		{"over dimension PNG", "image/png", overDim, true},
		{"corrupt PNG payload", "image/png", corruptPNG, true},
		{"corrupt JPEG payload", "image/jpeg", corruptJPG, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.validHeader {
				if _, _, err := image.DecodeConfig(bytes.NewReader(tt.data)); err != nil {
					t.Fatalf("DecodeConfig() error = %v", err)
				}
			}
			valid := encodeTestPNG(t, 16, 16)
			fetcher := newFakeImageFetcher(map[string]fakeImage{"https://example.com/bad": {data: tt.data, mediaType: tt.media}, "https://example.com/ok.png": {data: valid, mediaType: "image/png"}})
			books, err := newTestBuilder(Config{ImageFetcher: fetcher}).BuildBooks(context.Background(), "2026-03-15", []domain.KindleArticle{{ID: "a-1", URL: "https://example.com/posts/1", Title: "校验图片", HTMLBody: `<img src="https://example.com/bad"><img src="https://example.com/ok.png">`}})
			if err != nil {
				t.Fatalf("BuildBooks() error = %v", err)
			}
			reader := openArchive(t, books[0].Data)
			chapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0001.xhtml")))
			if strings.Count(chapter, "<img") != 1 || !strings.Contains(chapter, `src="../images/img-0001.png"`) {
				t.Fatalf("expected only valid PNG: %s", chapter)
			}
			if !bytes.Equal(entryBody(t, entryByName(t, reader, "OEBPS/images/img-0001.png")), valid) {
				t.Fatal("embedded image differs from valid PNG")
			}
		})
	}
}

func TestBuildBooksImagePrepDeadlineFallsBackWithoutFailingBook(t *testing.T) {
	t.Parallel()

	gate := make(chan struct{})
	defer close(gate)

	fetcher := &blockingImageFetcher{
		fastURL:  "https://example.com/fast.png",
		fastData: encodeTestPNG(t, 16, 16),
		slowURL:  "https://example.com/slow.png",
		gate:     gate,
	}

	articles := []domain.KindleArticle{{
		ID:       "article-1",
		URL:      "https://example.com/posts/1",
		Title:    "超时回退",
		HTMLBody: `<p>正文</p><img src="https://example.com/fast.png"><img src="https://example.com/slow.png">`,
	}}

	books, err := newTestBuilder(Config{
		ImageFetcher:     fetcher,
		ImagePrepTimeout: 30 * time.Millisecond,
	}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v, want fallback without error", err)
	}

	reader := openArchive(t, books[0].Data)
	chapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0001.xhtml")))
	if strings.Count(chapter, "<img") != 1 || !strings.Contains(chapter, `src="../images/img-0001.png"`) {
		t.Fatalf("expected fast.png kept and slow.png stripped, got:\n%s", chapter)
	}
}

func TestBuildBooksValidatesAndBoundsGIFs(t *testing.T) {
	t.Parallel()

	validAnimatedGIF := encodeAnimatedTestGIF(t, 16, 16, 2)
	tooManyFramesGIF := encodeAnimatedTestGIF(t, 2, 2, maxGIFFrames+1)
	corruptGIF := corruptGIFData(encodeAnimatedTestGIF(t, 16, 16, 2))
	outOfBoundsFrameGIF := outOfBoundsGIFFrame(encodeAnimatedTestGIF(t, 16, 16, 1))
	overBudgetGIF := encodeAnimatedTestGIF(t, 400, 400, 6)

	fetcher := newFakeImageFetcher(map[string]fakeImage{
		"https://example.com/ok.gif":          {data: validAnimatedGIF, mediaType: "image/gif"},
		"https://example.com/many-frames.gif": {data: tooManyFramesGIF, mediaType: "image/gif"},
		"https://example.com/corrupt.gif":     {data: corruptGIF, mediaType: "image/gif"},
		"https://example.com/oob.gif":         {data: outOfBoundsFrameGIF, mediaType: "image/gif"},
		"https://example.com/over-budget.gif": {data: overBudgetGIF, mediaType: "image/gif"},
	})

	articles := []domain.KindleArticle{{
		ID:    "a-1",
		URL:   "https://example.com/posts/1",
		Title: "GIF 边界",
		HTMLBody: strings.Join([]string{
			`<img src="https://example.com/many-frames.gif">`,
			`<img src="https://example.com/corrupt.gif">`,
			`<img src="https://example.com/oob.gif">`,
			`<img src="https://example.com/over-budget.gif">`,
			`<img src="https://example.com/ok.gif">`,
		}, ""),
	}}

	// 1 MiB decode budget admits validAnimatedGIF (~513 KiB) and rejects overBudgetGIF (~1.5 MiB).
	books, err := newTestBuilder(Config{
		ImageFetcher:            fetcher,
		ImageDecodeMemoryBudget: 1 << 20,
	}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	reader := openArchive(t, books[0].Data)
	chapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0001.xhtml")))
	if strings.Count(chapter, "<img") != 1 || !strings.Contains(chapter, `src="../images/img-0001.gif"`) {
		t.Fatalf("expected only ok.gif embedded, got:\n%s", chapter)
	}

	if got := entryBody(t, entryByName(t, reader, "OEBPS/images/img-0001.gif")); !bytes.Equal(got, validAnimatedGIF) {
		t.Fatal("embedded GIF bytes differ from original validAnimatedGIF")
	}
}
