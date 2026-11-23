package epub

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/rand"
	"encoding/xml"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"reader/internal/domain"
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

func TestBuildBooksProducesSingleValidBook(t *testing.T) {
	t.Parallel()

	publishedAt := time.Date(2026, 3, 14, 9, 30, 0, 0, time.UTC)
	articles := []domain.KindleArticle{
		{
			ID:          "saved-1",
			IsSavedPage: true,
			SourceTitle: "稍后阅读",
			URL:         "https://example.com/posts/1",
			Title:       "第一篇 & <文章>",
			HTMLBody:    `<p>Hello <strong>world</strong><br>line</p>`,
			PublishedAt: &publishedAt,
		},
		{
			ID:          "item-1",
			SourceTitle: "示例订阅源",
			URL:         "https://example.com/posts/2",
			Title:       "",
			HTMLBody:    "",
		},
	}

	books, err := NewBuilder(Config{}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	if len(books) != 1 {
		t.Fatalf("BuildBooks() returned %d books, want 1", len(books))
	}

	book := books[0]
	if book.Title != "拾叶 2026-03-15" {
		t.Fatalf("Title = %q, want %q", book.Title, "拾叶 2026-03-15")
	}

	if book.Filename != "leaf-2026-03-15.epub" {
		t.Fatalf("Filename = %q, want %q", book.Filename, "leaf-2026-03-15.epub")
	}

	if book.ArticleCount != 2 {
		t.Fatalf("ArticleCount = %d, want 2", book.ArticleCount)
	}

	if !slices.Equal(book.SavedPageIDs, []string{"saved-1"}) {
		t.Fatalf("SavedPageIDs = %v, want [saved-1]", book.SavedPageIDs)
	}

	if !slices.Equal(book.FeedItemIDs, []string{"item-1"}) {
		t.Fatalf("FeedItemIDs = %v, want [item-1]", book.FeedItemIDs)
	}

	reader := openArchive(t, book.Data)
	first := reader.File[0]
	if first.Name != "mimetype" {
		t.Fatalf("first zip entry = %q, want %q", first.Name, "mimetype")
	}

	if first.Method != zip.Store {
		t.Fatalf("mimetype method = %d, want %d", first.Method, zip.Store)
	}

	if len(first.Extra) != 0 {
		t.Fatalf("mimetype extra header = %v, want none", first.Extra)
	}

	if body := string(entryBody(t, first)); body != "application/epub+zip" {
		t.Fatalf("mimetype body = %q, want %q", body, "application/epub+zip")
	}

	xmlEntries := []string{
		"META-INF/container.xml",
		"OEBPS/content.opf",
		"OEBPS/nav.xhtml",
		"OEBPS/toc.ncx",
		"OEBPS/chapters/chapter-0001.xhtml",
		"OEBPS/chapters/chapter-0002.xhtml",
	}
	for _, name := range xmlEntries {
		requireValidXML(t, name, entryBody(t, entryByName(t, reader, name)))
	}

	nav := string(entryBody(t, entryByName(t, reader, "OEBPS/nav.xhtml")))
	if !strings.Contains(nav, `<a href="chapters/chapter-0001.xhtml">第一篇 &amp; &lt;文章&gt;</a>`) {
		t.Fatalf("nav.xhtml missing first chapter link:\n%s", nav)
	}

	if !strings.Contains(nav, `<a href="chapters/chapter-0002.xhtml">Untitled</a>`) {
		t.Fatalf("nav.xhtml missing untitled chapter link:\n%s", nav)
	}

	ncx := string(entryBody(t, entryByName(t, reader, "OEBPS/toc.ncx")))
	if !strings.Contains(ncx, `<content src="chapters/chapter-0001.xhtml"/>`) {
		t.Fatalf("toc.ncx missing first chapter:\n%s", ncx)
	}

	opf := string(entryBody(t, entryByName(t, reader, "OEBPS/content.opf")))
	if !strings.Contains(opf, "<dc:title>拾叶 2026-03-15</dc:title>") {
		t.Fatalf("content.opf missing book title:\n%s", opf)
	}

	if !strings.Contains(opf, `<itemref idref="chapter-0001"/>`+"\n"+`<itemref idref="chapter-0002"/>`) {
		t.Fatalf("content.opf spine is out of order:\n%s", opf)
	}

	firstChapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0001.xhtml")))
	if !strings.Contains(firstChapter, "<h1>第一篇 &amp; &lt;文章&gt;</h1>") {
		t.Fatalf("chapter-0001 missing escaped heading:\n%s", firstChapter)
	}

	if !strings.Contains(firstChapter, "Hello <strong>world</strong><br/>line") {
		t.Fatalf("chapter-0001 missing serialized body:\n%s", firstChapter)
	}

	if !strings.Contains(firstChapter, `<p class="article-meta">稍后阅读 · 2026-03-14 09:30 · <a href="https://example.com/posts/1">原文链接</a></p>`) {
		t.Fatalf("chapter-0001 missing article meta:\n%s", firstChapter)
	}

	secondChapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0002.xhtml")))
	if !strings.Contains(secondChapter, "<h1>Untitled</h1>") {
		t.Fatalf("chapter-0002 missing untitled heading:\n%s", secondChapter)
	}

	if !strings.Contains(secondChapter, `<div class="article-content"></div>`) {
		t.Fatalf("chapter-0002 missing empty content div:\n%s", secondChapter)
	}
}

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

	books, err := NewBuilder(Config{ImageFetcher: fetcher, ImageConcurrency: 2}).BuildBooks(context.Background(), "2026-03-15", articles)
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
		if !strings.HasPrefix(name, "OEBPS/images/") {
			continue
		}

		if _, ok := embeddedImages[name]; !ok {
			t.Fatalf("unexpected image entry %q in zip", name)
		}
	}
}

func TestBuildBooksSerializesChapterBodiesAsXML(t *testing.T) {
	t.Parallel()

	articles := []domain.KindleArticle{{
		ID:          "item-1",
		SourceTitle: "示例订阅源",
		URL:         "https://example.com/posts/1",
		Title:       "杂乱 HTML",
		HTMLBody: strings.Join([]string{
			`<p>a &amp; b &copy; &nbsp; &lt;tag&gt;</p>`,
			`<ul><li>one<li>two</ul>`,
			`<table><tr><td>cell</td></tr></table>`,
			`<pre><code>if (a < b) &amp;&amp; c</code></pre>`,
			`<!-- comment -->`,
			`<script>var x = "<b>";</script>`,
			`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>`,
			`<div data-x="1" :class="vue" @click="go()" title="line` + "\n" + `two">attrs</div>`,
			`<img src="data:image/png;base64,AAAA">`,
			`<video controls><source src="https://example.com/v.mp4" type="video/mp4"></video>`,
		}, ""),
	}}

	books, err := NewBuilder(Config{}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	reader := openArchive(t, books[0].Data)
	chapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0001.xhtml")))
	requireValidXML(t, "OEBPS/chapters/chapter-0001.xhtml", []byte(chapter))

	for _, want := range []string{
		`a &amp; b ©   &lt;tag&gt;`,
		`<ul><li>one</li><li>two</li></ul>`,
		`<table><tbody><tr><td>cell</td></tr></tbody></table>`,
		`<pre><code>if (a &lt; b) &amp;&amp; c</code></pre>`,
		`<script>var x = "&lt;b&gt;";</script>`,
		`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg>`,
		`<div data-x="1" title="line&#10;two">attrs</div>`,
		`<source src="https://example.com/v.mp4" type="video/mp4"/>`,
	} {
		if !strings.Contains(chapter, want) {
			t.Fatalf("chapter missing %q:\n%s", want, chapter)
		}
	}

	for _, unwanted := range []string{"<!--", ":class", "@click", "<img"} {
		if strings.Contains(chapter, unwanted) {
			t.Fatalf("chapter still contains %q:\n%s", unwanted, chapter)
		}
	}
}

func TestBuildBooksSplitsOversizedLibrariesInOrder(t *testing.T) {
	t.Parallel()

	const (
		articleBytes = 100 * 1024
		maxBytes     = 200 * 1024
	)

	titles := []string{"第一篇", "第二篇", "第三篇", "第四篇"}
	articles := make([]domain.KindleArticle, len(titles))
	for i, title := range titles {
		articles[i] = domain.KindleArticle{
			ID:          fmt.Sprintf("article-%d", i+1),
			IsSavedPage: i < 2,
			SourceTitle: "示例订阅源",
			URL:         fmt.Sprintf("https://example.com/posts/%d", i+1),
			Title:       title,
			HTMLBody:    "<p>" + randomText(t, articleBytes) + "</p>",
		}
	}

	books, err := NewBuilder(Config{MaxEPUBBytes: maxBytes}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	if len(books) != 2 {
		t.Fatalf("BuildBooks() returned %d books, want 2", len(books))
	}

	wantTitles := []string{"拾叶 2026-03-15 (1/2)", "拾叶 2026-03-15 (2/2)"}
	wantFilenames := []string{"leaf-2026-03-15-1.epub", "leaf-2026-03-15-2.epub"}
	wantSavedPageIDs := [][]string{{"article-1", "article-2"}, {}}
	wantFeedItemIDs := [][]string{{}, {"article-3", "article-4"}}
	wantChapterTitles := [][]string{{"第一篇", "第二篇"}, {"第三篇", "第四篇"}}

	for i, book := range books {
		if book.Title != wantTitles[i] {
			t.Fatalf("books[%d].Title = %q, want %q", i, book.Title, wantTitles[i])
		}

		if book.Filename != wantFilenames[i] {
			t.Fatalf("books[%d].Filename = %q, want %q", i, book.Filename, wantFilenames[i])
		}

		if book.ArticleCount != 2 {
			t.Fatalf("books[%d].ArticleCount = %d, want 2", i, book.ArticleCount)
		}

		if !slices.Equal(book.SavedPageIDs, wantSavedPageIDs[i]) {
			t.Fatalf("books[%d].SavedPageIDs = %v, want %v", i, book.SavedPageIDs, wantSavedPageIDs[i])
		}

		if !slices.Equal(book.FeedItemIDs, wantFeedItemIDs[i]) {
			t.Fatalf("books[%d].FeedItemIDs = %v, want %v", i, book.FeedItemIDs, wantFeedItemIDs[i])
		}

		if len(book.Data) > maxBytes {
			t.Fatalf("books[%d] is %d bytes, want at most %d", i, len(book.Data), maxBytes)
		}

		reader := openArchive(t, book.Data)
		opf := string(entryBody(t, entryByName(t, reader, "OEBPS/content.opf")))
		if !strings.Contains(opf, "<dc:title>"+wantTitles[i]+"</dc:title>") {
			t.Fatalf("books[%d] content.opf missing title %q:\n%s", i, wantTitles[i], opf)
		}

		for chapterIndex, chapterTitle := range wantChapterTitles[i] {
			name := fmt.Sprintf("OEBPS/chapters/chapter-%04d.xhtml", chapterIndex+1)
			chapter := string(entryBody(t, entryByName(t, reader, name)))
			if !strings.Contains(chapter, "<h1>"+chapterTitle+"</h1>") {
				t.Fatalf("books[%d] %s missing heading %q:\n%s", i, name, chapterTitle, chapter)
			}
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

	books, err := NewBuilder(Config{}).BuildBooks(context.Background(), "2026-03-15", articles)
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

	books, err := NewBuilder(Config{ImageFetcher: fetcher, MaxEPUBBytes: maxBytes}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	if len(books) != 1 {
		t.Fatalf("BuildBooks() returned %d books, want 1", len(books))
	}

	book := books[0]
	if book.Title != "拾叶 2026-03-15" {
		t.Fatalf("Title = %q, want %q", book.Title, "拾叶 2026-03-15")
	}

	if book.Filename != "leaf-2026-03-15.epub" {
		t.Fatalf("Filename = %q, want %q", book.Filename, "leaf-2026-03-15.epub")
	}

	if len(book.Data) > maxBytes {
		t.Fatalf("text-only book is %d bytes, want at most %d", len(book.Data), maxBytes)
	}

	reader := openArchive(t, book.Data)
	for _, file := range reader.File {
		if strings.HasPrefix(file.Name, "OEBPS/images/") {
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

	books, err := NewBuilder(Config{ImageFetcher: fetcher, MaxEPUBBytes: maxBytes}).BuildBooks(context.Background(), "2026-03-15", articles)
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

func TestBuildBooksKeepsNumberedBooksWithinLimit(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	baseTitle := "拾叶 2026-03-15"
	articles := make([]domain.KindleArticle, 4)
	for i := range articles {
		articles[i] = domain.KindleArticle{
			ID:       fmt.Sprintf("article-%d", i+1),
			URL:      fmt.Sprintf("https://example.com/posts/%d", i+1),
			Title:    fmt.Sprintf("第%d篇", i+1),
			HTMLBody: "<p>" + randomText(t, 48*1024) + "</p>",
		}
	}

	chapters, err := parseChapters(ctx, articles[:2])
	if err != nil {
		t.Fatalf("parseChapters() error = %v", err)
	}

	unnumbered, err := renderEPUB(ctx, baseTitle, chapters, nil, false)
	if err != nil {
		t.Fatalf("renderEPUB() error = %v", err)
	}

	numbered, err := renderEPUB(ctx, baseTitle+" (1/2)", chapters, nil, false)
	if err != nil {
		t.Fatalf("renderEPUB() error = %v", err)
	}

	maxBytes := len(unnumbered) + 5
	if len(numbered) <= maxBytes {
		t.Fatalf("numbered pair book is %d bytes with limit %d, want the numbering to exceed the limit", len(numbered), maxBytes)
	}

	books, err := NewBuilder(Config{MaxEPUBBytes: maxBytes}).BuildBooks(ctx, "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	if len(books) < 2 {
		t.Fatalf("BuildBooks() returned %d books, want at least 2", len(books))
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

	books, err := NewBuilder(Config{ImageFetcher: fetcher, MaxEPUBBytes: maxBytes}).BuildBooks(context.Background(), "2026-03-15", articles)
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

	books, err := NewBuilder(Config{ImageFetcher: fetcher}).BuildBooks(context.Background(), "2026-03-15", articles)
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

	// GIF header declaring 0x0 dimensions (unsized GIF).
	unsizedGIF := []byte("GIF89a\x00\x00\x00\x00\x00\x00\x00;")
	// Valid PNG header declaring 7000x10 dimensions (> maxImageDecodeDimension).
	overDimPNG := encodeTestPNG(t, 16, 16)
	// Patch IHDR width (bytes 16..19) to 7000 (0x00001B58) -> DecodeConfig fails cap, never decoded.
	overDimPNG[16], overDimPNG[17], overDimPNG[18], overDimPNG[19] = 0x00, 0x00, 0x1b, 0x58

	validPNG := encodeTestPNG(t, 16, 16)

	fetcher := newFakeImageFetcher(map[string]fakeImage{
		"https://example.com/bad.png":     {data: []byte("\x89PNG\r\n\x1a\nnot-a-png"), mediaType: "image/png"},
		"https://example.com/bad.jpg":     {data: []byte("\xff\xd8\xffnot-a-jpg"), mediaType: "image/jpeg"},
		"https://example.com/unsized.gif": {data: unsizedGIF, mediaType: "image/gif"},
		"https://example.com/huge.png":    {data: overDimPNG, mediaType: "image/png"},
		"https://example.com/ok.png":      {data: validPNG, mediaType: "image/png"},
	})

	articles := []domain.KindleArticle{{
		ID:       "article-1",
		URL:      "https://example.com/posts/1",
		Title:    "校验图片",
		HTMLBody: `<img src="https://example.com/bad.png"><img src="https://example.com/bad.jpg"><img src="https://example.com/unsized.gif"><img src="https://example.com/huge.png"><img src="https://example.com/ok.png">`,
	}}

	books, err := NewBuilder(Config{ImageFetcher: fetcher}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	reader := openArchive(t, books[0].Data)
	chapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0001.xhtml")))
	if strings.Count(chapter, "<img") != 1 || !strings.Contains(chapter, `src="../images/img-0001.png"`) {
		t.Fatalf("expected only ok.png embedded, got:\n%s", chapter)
	}
}

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

func TestBuildBooksChargesSixteenBitPNGAgainstDecodeBudget(t *testing.T) {
	t.Parallel()

	const side = 1000

	// 8-bit costs about 8.5 MB (4 B/px source + 4 B/px target + workspace) and
	// 16-bit about 12.5 MB, so this budget admits only the 8-bit image.
	const budget = 10 << 20

	eightBit := image.NewNRGBA(image.Rect(0, 0, side, side))
	sixteenBit := image.NewNRGBA64(image.Rect(0, 0, side, side))

	for _, pix := range [][]byte{eightBit.Pix, sixteenBit.Pix} {
		if _, err := rand.Read(pix); err != nil {
			t.Fatalf("rand.Read() error = %v", err)
		}
	}

	encode := func(canvas image.Image) []byte {
		var buf bytes.Buffer
		if err := (&png.Encoder{CompressionLevel: png.NoCompression}).Encode(&buf, canvas); err != nil {
			t.Fatalf("png.Encode() error = %v", err)
		}

		return buf.Bytes()
	}

	fetcher := newFakeImageFetcher(map[string]fakeImage{
		"https://example.com/eight.png":   {data: encode(eightBit), mediaType: "image/png"},
		"https://example.com/sixteen.png": {data: encode(sixteenBit), mediaType: "image/png"},
	})
	articles := []domain.KindleArticle{{
		ID:       "article-1",
		URL:      "https://example.com/posts/1",
		Title:    "位深",
		HTMLBody: `<p>正文</p><img src="https://example.com/eight.png"><img src="https://example.com/sixteen.png">`,
	}}

	books, err := NewBuilder(Config{ImageFetcher: fetcher, ImageDecodeMemoryBudget: budget}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	chapter := string(entryBody(t, entryByName(t, openArchive(t, books[0].Data), "OEBPS/chapters/chapter-0001.xhtml")))
	if strings.Count(chapter, "<img") != 1 {
		t.Fatalf("expected only the 8-bit image embedded within the %d byte budget, got:\n%s", budget, chapter)
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
}

func (f *blockingImageFetcher) FetchImage(ctx context.Context, rawURL string) ([]byte, string, string, error) {
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

	books, err := NewBuilder(Config{
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

func TestBuildBooksPropagatesParentContextCancellation(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, err := NewBuilder(Config{}).BuildBooks(ctx, "2026-03-15", []domain.KindleArticle{{
		ID:       "article-1",
		Title:    "已取消",
		HTMLBody: "<p>hello</p>",
	}})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("BuildBooks() error = %v, want context.Canceled", err)
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
