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
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
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
	if book.Title != "Lantern 2026-03-15" {
		t.Fatalf("Title = %q, want %q", book.Title, "Lantern 2026-03-15")
	}

	if book.Filename != "lantern-2026-03-15.epub" {
		t.Fatalf("Filename = %q, want %q", book.Filename, "lantern-2026-03-15.epub")
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
	if !strings.Contains(opf, "<dc:title>Lantern 2026-03-15</dc:title>") {
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

	wantTitles := []string{"Lantern 2026-03-15 (1/2)", "Lantern 2026-03-15 (2/2)"}
	wantFilenames := []string{"lantern-2026-03-15-1.epub", "lantern-2026-03-15-2.epub"}
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
	articles := make([]domain.KindleArticle, 4)
	for i := range articles {
		articles[i] = domain.KindleArticle{
			ID:       fmt.Sprintf("article-%d", i+1),
			URL:      fmt.Sprintf("https://example.com/posts/%d", i+1),
			Title:    fmt.Sprintf("第%d篇", i+1),
			HTMLBody: "<p>" + randomText(t, 48*1024) + "</p>",
		}
	}

	unnumberedBooks, err := NewBuilder(Config{}).BuildBooks(ctx, "2026-03-15", articles[:2])
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	unnumbered := unnumberedBooks[0].Data
	maxBytes := len(unnumbered) + 5

	// A 2-part numbered title (" (1/2)") adds >5 bytes across nav/ncx/opf,
	// so packing with the padded upper-bound title prevents exceeding maxBytes.
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

	nonInterlaced8 := encodeTestPNG(t, side, side)
	interlaced8 := encodeTestInterlacedPNG(t, side, side, false)
	interlaced16 := encodeTestInterlacedPNG(t, side, side, true)

	// Make sure all images trigger optimization (> 128 KiB).
	for name, img := range map[string][]byte{
		"nonInterlaced8": nonInterlaced8,
		"interlaced8":    interlaced8,
		"interlaced16":   interlaced16,
	} {
		if len(img) <= imageReencodeMinBytes {
			t.Fatalf("%s len = %d, want > %d", name, len(img), imageReencodeMinBytes)
		}
	}

	fetcher := newFakeImageFetcher(map[string]fakeImage{
		"https://example.com/plain8.png":       {data: nonInterlaced8, mediaType: "image/png"},
		"https://example.com/interlaced8.png":  {data: interlaced8, mediaType: "image/png"},
		"https://example.com/interlaced16.png": {data: interlaced16, mediaType: "image/png"},
	})

	article := domain.KindleArticle{
		ID:       "article-1",
		URL:      "https://example.com/posts/1",
		Title:    "隔行扫描",
		HTMLBody: `<p>正文</p><img src="https://example.com/plain8.png"><img src="https://example.com/interlaced8.png"><img src="https://example.com/interlaced16.png">`,
	}

	// 8-bit plain ~8.5 MiB, 8-bit interlaced ~10.5 MiB, 16-bit interlaced ~16.5 MiB.
	books95, err := NewBuilder(Config{ImageFetcher: fetcher, ImageDecodeMemoryBudget: 9_500_000}).BuildBooks(context.Background(), "2026-03-15", []domain.KindleArticle{article})
	if err != nil {
		t.Fatalf("BuildBooks(9.5MB) error = %v", err)
	}
	ch95 := string(entryBody(t, entryByName(t, openArchive(t, books95[0].Data), "OEBPS/chapters/chapter-0001.xhtml")))
	if strings.Count(ch95, "<img") != 1 {
		t.Fatalf("9.5MB budget embedded %d images, want 1 (plain 8-bit only):\n%s", strings.Count(ch95, "<img"), ch95)
	}

	// 15 MB admits plain 8-bit and interlaced 8-bit (~10.5 MB), excludes interlaced 16-bit (~16.5 MB).
	books15, err := NewBuilder(Config{ImageFetcher: fetcher, ImageDecodeMemoryBudget: 15 << 20}).BuildBooks(context.Background(), "2026-03-15", []domain.KindleArticle{article})
	if err != nil {
		t.Fatalf("BuildBooks(15MiB) error = %v", err)
	}
	ch15 := string(entryBody(t, entryByName(t, openArchive(t, books15[0].Data), "OEBPS/chapters/chapter-0001.xhtml")))
	if strings.Count(ch15, "<img") != 2 {
		t.Fatalf("15MiB budget embedded %d images, want 2 (8-bit plain + 8-bit interlaced):\n%s", strings.Count(ch15, "<img"), ch15)
	}

	// 18 MiB admits all three.
	books18, err := NewBuilder(Config{ImageFetcher: fetcher, ImageDecodeMemoryBudget: 18 << 20}).BuildBooks(context.Background(), "2026-03-15", []domain.KindleArticle{article})
	if err != nil {
		t.Fatalf("BuildBooks(18MiB) error = %v", err)
	}
	ch18 := string(entryBody(t, entryByName(t, openArchive(t, books18[0].Data), "OEBPS/chapters/chapter-0001.xhtml")))
	if strings.Count(ch18, "<img") != 3 {
		t.Fatalf("18MiB budget embedded %d images, want 3:\n%s", strings.Count(ch18, "<img"), ch18)
	}
}

func TestPackerOverLimitTrialAbortsEarly(t *testing.T) {
	t.Parallel()

	const maxBytes = 64 * 1024
	const addedEntrySize = 512 * 1024

	measured, err := measureArchiveSize(
		context.Background(),
		archiveMeta{
			title:    "Lantern 2026-03-15 (1/2)",
			identity: newBookIdentity(),
			chapters: []chapterMeta{{title: "Oversize"}},
		},
		nil,
		[]spooledEntry{{
			name:             "OEBPS/chapters/chapter-0001.xhtml",
			method:           zip.Deflate,
			compressedSize:   addedEntrySize,
			uncompressedSize: addedEntrySize,
		}},
		maxBytes,
	)
	if !errors.Is(err, errArchiveTooLarge) {
		t.Fatalf("measureArchiveSize() err = %v, want errArchiveTooLarge", err)
	}
	if measured >= addedEntrySize/2 {
		t.Fatalf("measureArchiveSize() wrote %d bytes before aborting, expected early abort near %d", measured, maxBytes)
	}

	_, compErr := compressDeflateBounded("OEBPS/chapters/chapter-0001.xhtml", randomBytes(t, addedEntrySize), maxBytes)
	if !errors.Is(compErr, errArchiveTooLarge) {
		t.Fatalf("compressDeflateBounded() err = %v, want errArchiveTooLarge", compErr)
	}
}

func TestPackerSpoolCleanupOnSuccessFailureAndCancel(t *testing.T) {
	t.Parallel()

	t.Run("success removes spool files and uses 0600 mode", func(t *testing.T) {
		t.Parallel()

		spoolDir := t.TempDir()
		packer, err := NewBuilder(Config{MaxEPUBBytes: 200 * 1024, SpoolDir: spoolDir}).NewPacker(context.Background(), "2026-03-15")
		if err != nil {
			t.Fatalf("NewPacker() error = %v", err)
		}
		defer func() { _ = packer.Close() }()

		for i := range 4 {
			err := packer.AddArticle(context.Background(), domain.KindleArticle{
				ID:       fmt.Sprintf("a-%d", i+1),
				Title:    fmt.Sprintf("篇 %d", i+1),
				HTMLBody: "<p>" + randomText(t, 100*1024) + "</p>",
			})
			if err != nil {
				t.Fatalf("AddArticle(%d) error = %v", i, err)
			}
		}

		count, err := packer.Finish(context.Background())
		if err != nil {
			t.Fatalf("Finish() error = %v", err)
		}
		if count != 2 {
			t.Fatalf("Finish() count = %d, want 2", count)
		}

		entries, err := os.ReadDir(spoolDir)
		if err != nil {
			t.Fatalf("ReadDir() error = %v", err)
		}
		if len(entries) != 2 {
			t.Fatalf("spool entries after Finish = %d, want 2", len(entries))
		}
		for _, entry := range entries {
			info, err := os.Stat(filepath.Join(spoolDir, entry.Name()))
			if err != nil {
				t.Fatalf("Stat(%s) error = %v", entry.Name(), err)
			}
			if perm := info.Mode().Perm(); perm != 0o600 {
				t.Fatalf("spool file %s mode = %o, want 0600", entry.Name(), perm)
			}
		}

		for i := range count {
			book, err := packer.ReadBook(context.Background(), i)
			if err != nil {
				t.Fatalf("ReadBook(%d) error = %v", i, err)
			}
			if len(book.Data) == 0 {
				t.Fatalf("ReadBook(%d) returned empty data", i)
			}
		}

		if err := packer.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}

		remaining, err := os.ReadDir(spoolDir)
		if err != nil {
			t.Fatalf("ReadDir() after Close error = %v", err)
		}
		if len(remaining) != 0 {
			t.Fatalf("leftover spool files after success: %v", remaining)
		}
	})

	t.Run("oversize text-only failure cleans up prior spool files", func(t *testing.T) {
		t.Parallel()

		spoolDir := t.TempDir()
		packer, err := NewBuilder(Config{MaxEPUBBytes: 64 * 1024, SpoolDir: spoolDir}).NewPacker(context.Background(), "2026-03-15")
		if err != nil {
			t.Fatalf("NewPacker() error = %v", err)
		}

		if err := packer.AddArticle(context.Background(), domain.KindleArticle{
			ID:       "ok-1",
			Title:    "正常文章",
			HTMLBody: "<p>" + randomText(t, 40*1024) + "</p>",
		}); err != nil {
			t.Fatalf("AddArticle(ok) error = %v", err)
		}

		addErr := packer.AddArticle(context.Background(), domain.KindleArticle{
			ID:       "too-big",
			Title:    "超大纯文本",
			HTMLBody: "<p>" + randomText(t, 128*1024) + "</p>",
		})
		if addErr == nil || !strings.Contains(addErr.Error(), "even without images") {
			t.Fatalf("AddArticle(too-big) error = %v, want even without images oversize error", addErr)
		}

		if err := packer.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}

		remaining, err := os.ReadDir(spoolDir)
		if err != nil {
			t.Fatalf("ReadDir() error = %v", err)
		}
		if len(remaining) != 0 {
			t.Fatalf("leftover spool files after failure: %v", remaining)
		}
	})

	t.Run("context cancel cleans up spool files", func(t *testing.T) {
		t.Parallel()

		spoolDir := t.TempDir()
		ctx, cancel := context.WithCancel(context.Background())
		packer, err := NewBuilder(Config{MaxEPUBBytes: 128 * 1024, SpoolDir: spoolDir}).NewPacker(ctx, "2026-03-15")
		if err != nil {
			t.Fatalf("NewPacker() error = %v", err)
		}

		if err := packer.AddArticle(ctx, domain.KindleArticle{
			ID:       "ok-1",
			Title:    "第一篇",
			HTMLBody: "<p>" + randomText(t, 32*1024) + "</p>",
		}); err != nil {
			t.Fatalf("AddArticle() error = %v", err)
		}

		cancel()
		if err := packer.AddArticle(ctx, domain.KindleArticle{
			ID:       "canceled-2",
			Title:    "第二篇",
			HTMLBody: "<p>hello</p>",
		}); !errors.Is(err, context.Canceled) {
			t.Fatalf("AddArticle(canceled) error = %v, want context.Canceled", err)
		}

		if err := packer.Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}

		remaining, err := os.ReadDir(spoolDir)
		if err != nil {
			t.Fatalf("ReadDir() error = %v", err)
		}
		if len(remaining) != 0 {
			t.Fatalf("leftover spool files after cancel: %v", remaining)
		}
	})
}

func TestPackerEnforcesPerJobSpoolQuota(t *testing.T) {
	t.Parallel()

	spoolDir := t.TempDir()
	packer, err := NewBuilder(Config{
		MaxEPUBBytes:     128 * 1024,
		MaxJobSpoolBytes: 150 * 1024,
		SpoolDir:         spoolDir,
	}).NewPacker(context.Background(), "2026-03-15")
	if err != nil {
		t.Fatalf("NewPacker() error = %v", err)
	}

	var quotaErr error
	for i := range 4 {
		err := packer.AddArticle(context.Background(), domain.KindleArticle{
			ID:       fmt.Sprintf("a-%d", i+1),
			Title:    fmt.Sprintf("文章 %d", i+1),
			HTMLBody: "<p>" + randomText(t, 80*1024) + "</p>",
		})
		if err != nil {
			quotaErr = err
			break
		}
	}

	if quotaErr == nil || !strings.Contains(quotaErr.Error(), "spool quota exceeded") {
		t.Fatalf("expected spool quota error, got %v", quotaErr)
	}

	if err := packer.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	remaining, err := os.ReadDir(spoolDir)
	if err != nil {
		t.Fatalf("ReadDir() error = %v", err)
	}
	if len(remaining) != 0 {
		t.Fatalf("leftover spool files after quota failure: %v", remaining)
	}
}

func TestPackerEnforcesPerBookImageBudget(t *testing.T) {
	t.Parallel()

	img1 := encodeTestPNG(t, 95, 95) // ~36 KiB <= 128 KiB, kept as PNG
	img2 := encodeTestPNG(t, 95, 95)
	img3 := encodeTestPNG(t, 95, 95)
	if len(img1) <= 30*1024 || len(img1) >= 50*1024 {
		t.Fatalf("unexpected test PNG size: %d", len(img1))
	}

	fetcher := newFakeImageFetcher(map[string]fakeImage{
		"https://example.com/1.png": {data: img1, mediaType: "image/png"},
		"https://example.com/2.png": {data: img2, mediaType: "image/png"},
		"https://example.com/3.png": {data: img3, mediaType: "image/png"},
	})

	books, err := NewBuilder(Config{
		ImageFetcher:      fetcher,
		MaxEPUBBytes:      512 * 1024,
		MaxBookImageBytes: 50 * 1024,
	}).BuildBooks(context.Background(), "2026-03-15", []domain.KindleArticle{{
		ID:       "a-1",
		URL:      "https://example.com/posts/1",
		Title:    "图片预算",
		HTMLBody: `<p>正文</p><img src="https://example.com/1.png"><img src="https://example.com/2.png"><img src="https://example.com/3.png">`,
	}})
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	reader := openArchive(t, books[0].Data)
	chapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0001.xhtml")))
	if strings.Count(chapter, "<img") != 1 || !strings.Contains(chapter, `src="../images/img-0001.png"`) {
		t.Fatalf("expected only first image within per-book budget, got:\n%s", chapter)
	}
}

func TestPackerSharesSingleImagePrepDeadlineAcrossArticles(t *testing.T) {
	t.Parallel()

	const (
		prepTimeout  = 80 * time.Millisecond
		articleCount = 30
	)

	gate := make(chan struct{})
	defer close(gate)

	fetcher := &blockingImageFetcher{
		fastURL:  "https://example.com/fast.png",
		fastData: encodeTestPNG(t, 16, 16),
		gate:     gate,
	}

	articles := make([]domain.KindleArticle, articleCount)
	for i := range articles {
		body := fmt.Sprintf(`<p>article-%d</p><img src="https://example.com/slow-%d.png">`, i+1, i+1)
		if i == 0 {
			body = `<p>article-1</p><img src="https://example.com/fast.png"><img src="https://example.com/slow-1.png">`
		}

		articles[i] = domain.KindleArticle{
			ID:       fmt.Sprintf("a-%d", i+1),
			URL:      fmt.Sprintf("https://example.com/posts/%d", i+1),
			Title:    fmt.Sprintf("文章 %d", i+1),
			HTMLBody: body,
		}
	}

	start := time.Now()
	books, err := NewBuilder(Config{
		ImageFetcher:     fetcher,
		ImagePrepTimeout: prepTimeout,
		MaxEPUBBytes:     64 * 1024,
	}).BuildBooks(context.Background(), "2026-03-15", articles)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	// 30 articles with per-article timeouts would take >= 2.4s; one shared job
	// budget completes well under half of that even under -race CPU contention.
	if elapsed >= 10*prepTimeout {
		t.Fatalf("BuildBooks() took %v, expected well below per-article timeout total (%v)", elapsed, time.Duration(articleCount)*prepTimeout)
	}

	if gotCalls := fetcher.calls.Load(); gotCalls > 2 {
		t.Fatalf("FetchImage called %d times, expected <= 2 (fast + slow in article 1 before deadline expiry)", gotCalls)
	}

	totalArticles := 0
	for _, book := range books {
		totalArticles += book.ArticleCount
		reader := openArchive(t, book.Data)
		for _, f := range reader.File {
			if strings.HasPrefix(f.Name, "OEBPS/chapters/") {
				ch := string(entryBody(t, f))
				if f.Name == "OEBPS/chapters/chapter-0001.xhtml" && book.Filename == books[0].Filename {
					if strings.Count(ch, "<img") != 1 || !strings.Contains(ch, `src="../images/img-0001.png"`) {
						t.Fatalf("expected fast.png kept and slow-1 stripped in chapter 1, got:\n%s", ch)
					}
					continue
				}

				if strings.Contains(ch, "<img") {
					t.Fatalf("expected slow image stripped after shared deadline in %s (%s), got:\n%s", book.Filename, f.Name, ch)
				}
			}
		}
	}

	if totalArticles != articleCount {
		t.Fatalf("total ArticleCount = %d, want %d", totalArticles, articleCount)
	}
}

func TestPrepareSpoolDirCleansLeftoversAndEnforces0700(t *testing.T) {
	t.Parallel()

	parent := t.TempDir()
	spoolDir := filepath.Join(parent, "spool")
	if err := os.MkdirAll(filepath.Join(spoolDir, "nested"), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	if err := os.WriteFile(filepath.Join(spoolDir, "stale.spool"), []byte("stale"), 0o644); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	if err := os.WriteFile(filepath.Join(spoolDir, "nested", "inner.spool"), []byte("inner"), 0o600); err != nil {
		t.Fatalf("WriteFile(nested) error = %v", err)
	}

	if err := PrepareSpoolDir(spoolDir); err != nil {
		t.Fatalf("PrepareSpoolDir() error = %v", err)
	}

	info, err := os.Stat(spoolDir)
	if err != nil {
		t.Fatalf("Stat() error = %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o700 {
		t.Fatalf("spool dir mode = %o, want 0700", perm)
	}

	entries, err := os.ReadDir(spoolDir)
	if err != nil {
		t.Fatalf("ReadDir() error = %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("expected clean spool dir, got %v", entries)
	}
}

func TestPackerRetriesSpoolRemovalOnCloseAfterReadBookFailure(t *testing.T) {
	t.Parallel()

	spoolDir := t.TempDir()
	rawPacker, err := NewBuilder(Config{SpoolDir: spoolDir}).NewPacker(context.Background(), "2026-03-15")
	if err != nil {
		t.Fatalf("NewPacker() error = %v", err)
	}

	p := rawPacker.(*packer)
	defer func() {
		p.removeFile = os.Remove
		_ = p.Close()
	}()

	if err := p.AddArticle(context.Background(), domain.KindleArticle{
		ID:       "a-1",
		Title:    "文章 1",
		HTMLBody: "<p>hello</p>",
	}); err != nil {
		t.Fatalf("AddArticle() error = %v", err)
	}

	if _, err := p.Finish(context.Background()); err != nil {
		t.Fatalf("Finish() error = %v", err)
	}

	p.removeFile = func(string) error {
		return errors.New("transient remove failure")
	}

	if _, err := p.ReadBook(context.Background(), 0); err == nil {
		t.Fatal("expected ReadBook() error when spool removal fails")
	}

	if _, err := p.ReadBook(context.Background(), 0); err == nil || !strings.Contains(err.Error(), "already consumed") {
		t.Fatalf("expected consumed error on second ReadBook(), got %v", err)
	}

	entries, err := os.ReadDir(spoolDir)
	if err != nil {
		t.Fatalf("ReadDir() error = %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("spool files after failed ReadBook remove = %d, want 1 retained for Close retry", len(entries))
	}

	p.removeFile = os.Remove
	if err := p.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	entries, err = os.ReadDir(spoolDir)
	if err != nil {
		t.Fatalf("ReadDir() after Close error = %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("leftover spool files after Close retry: %v", entries)
	}
}

func TestChapterNavOpfUncompressedBytesMatchesRenderedDelta(t *testing.T) {
	t.Parallel()

	identity := newBookIdentity()
	meta := archiveMeta{
		title:    "Lantern 2026-03-15 (987654/987654)",
		identity: identity,
	}

	testCases := []struct {
		index  int
		title  string
		images []imageManifestItem
	}{
		{index: 0, title: "Plain title"},
		{index: 1, title: "Title & <escaped> > text", images: []imageManifestItem{{number: 1, fileName: "img-0001.jpg", mediaType: "image/jpeg"}}},
		{index: 9998, title: "Four digits"},
		{index: 9999, title: "Five digits", images: []imageManifestItem{{number: 10000, fileName: "img-10000.png", mediaType: "image/png"}}},
	}

	for _, tc := range testCases {
		for len(meta.chapters) < tc.index {
			meta.chapters = append(meta.chapters, chapterMeta{title: "filler"})
		}

		before := len(renderNav(meta.title, meta.chapters)) + len(renderNCX(meta)) + len(renderOPF(meta))
		meta.chapters = append(meta.chapters, chapterMeta{title: tc.title})
		meta.images = append(meta.images, tc.images...)
		after := len(renderNav(meta.title, meta.chapters)) + len(renderNCX(meta)) + len(renderOPF(meta))

		got := chapterNavOpfUncompressedBytes(tc.index, tc.title, tc.images)
		want := int64(after - before)
		if got != want {
			t.Fatalf("index %d: chapterNavOpfUncompressedBytes() = %d, want %d", tc.index, got, want)
		}
	}
}

func TestPackerPacks5000TinyArticlesWithSublinearMeasurements(t *testing.T) {
	const articleCount = 5000
	articles := make([]domain.KindleArticle, articleCount)
	for i := range articles {
		articles[i] = domain.KindleArticle{
			ID:       fmt.Sprintf("tiny-%d", i+1),
			Title:    fmt.Sprintf("Tiny %d", i+1),
			HTMLBody: "<p>ok</p>",
		}
	}

	t.Run("single 20 MiB book skips intermediate measurements", func(t *testing.T) {
		rawPacker, err := NewBuilder(Config{}).NewPacker(context.Background(), "2026-03-15")
		if err != nil {
			t.Fatalf("NewPacker() error = %v", err)
		}
		p := rawPacker.(*packer)
		defer func() { _ = p.Close() }()

		for _, art := range articles {
			if err := p.AddArticle(context.Background(), art); err != nil {
				t.Fatalf("AddArticle(%s) error = %v", art.ID, err)
			}
		}

		count, err := p.Finish(context.Background())
		if err != nil {
			t.Fatalf("Finish() error = %v", err)
		}
		if count != 1 {
			t.Fatalf("Finish() count = %d, want 1", count)
		}

		if p.measureCount != 0 {
			t.Fatalf("measureCount = %d for 5000 tiny articles in 1 book, want 0", p.measureCount)
		}

		book, err := p.ReadBook(context.Background(), 0)
		if err != nil {
			t.Fatalf("ReadBook() error = %v", err)
		}
		if len(book.Data) > domain.MaxKindleEPUBBytes {
			t.Fatalf("book size = %d > %d", len(book.Data), domain.MaxKindleEPUBBytes)
		}
		if book.ArticleCount != articleCount {
			t.Fatalf("ArticleCount = %d, want %d", book.ArticleCount, articleCount)
		}
	})

	t.Run("multi-book split runs O(n/books) measurements", func(t *testing.T) {
		const maxBytes = 256 * 1024
		rawPacker, err := NewBuilder(Config{MaxEPUBBytes: maxBytes}).NewPacker(context.Background(), "2026-03-15")
		if err != nil {
			t.Fatalf("NewPacker() error = %v", err)
		}
		p := rawPacker.(*packer)
		defer func() { _ = p.Close() }()

		for _, art := range articles {
			if err := p.AddArticle(context.Background(), art); err != nil {
				t.Fatalf("AddArticle(%s) error = %v", art.ID, err)
			}
		}

		bookCount, err := p.Finish(context.Background())
		if err != nil {
			t.Fatalf("Finish() error = %v", err)
		}
		if bookCount < 2 {
			t.Fatalf("bookCount = %d, want >= 2", bookCount)
		}

		if p.measureCount >= articleCount/5 {
			t.Fatalf("measureCount = %d for %d articles across %d books, expected O(n/books) << %d", p.measureCount, articleCount, bookCount, articleCount/5)
		}

		packedArticles := 0
		for i := range bookCount {
			book, err := p.ReadBook(context.Background(), i)
			if err != nil {
				t.Fatalf("ReadBook(%d) error = %v", i, err)
			}
			if len(book.Data) > maxBytes {
				t.Fatalf("book %d size = %d > %d", i, len(book.Data), maxBytes)
			}
			packedArticles += book.ArticleCount
			openArchive(t, book.Data)
		}

		if packedArticles != articleCount {
			t.Fatalf("packedArticles = %d, want %d", packedArticles, articleCount)
		}
	})
}

func TestPackerBoundaryNearLimitNeverExceedsMaxBytes(t *testing.T) {
	t.Parallel()

	const baseMaxBytes = 128 * 1024
	articles := make([]domain.KindleArticle, 120)
	for i := range articles {
		articles[i] = domain.KindleArticle{
			ID:       fmt.Sprintf("b-%d", i+1),
			Title:    "Title &" + randomText(t, 40),
			HTMLBody: "<p>" + randomText(t, 1800) + "</p>",
		}
	}

	// Probe multiple byte limits around the multi-book and margin boundaries.
	for _, maxBytes := range []int{baseMaxBytes, baseMaxBytes + 7, baseMaxBytes + 513, baseMaxBytes - 4093} {
		books, err := NewBuilder(Config{MaxEPUBBytes: maxBytes}).BuildBooks(context.Background(), "2026-03-15", articles)
		if err != nil {
			t.Fatalf("BuildBooks(maxBytes=%d) error = %v", maxBytes, err)
		}
		if len(books) < 2 {
			t.Fatalf("BuildBooks(maxBytes=%d) returned %d books, want >= 2", maxBytes, len(books))
		}

		packed := 0
		for i, book := range books {
			if len(book.Data) > maxBytes {
				t.Fatalf("maxBytes=%d book %d size = %d exceeds limit", maxBytes, i, len(book.Data))
			}
			packed += book.ArticleCount
			openArchive(t, book.Data)
		}

		if packed != len(articles) {
			t.Fatalf("maxBytes=%d packed = %d, want %d", maxBytes, packed, len(articles))
		}
	}
}

func TestPackerSharesBookIdentityBetweenMeasureAndFinalArchive(t *testing.T) {
	t.Parallel()

	rawPacker, err := NewBuilder(Config{MaxEPUBBytes: 64 * 1024}).NewPacker(context.Background(), "2026-03-15")
	if err != nil {
		t.Fatalf("NewPacker() error = %v", err)
	}
	p := rawPacker.(*packer)
	defer func() { _ = p.Close() }()

	if err := p.AddArticle(context.Background(), domain.KindleArticle{
		ID:       "a-1",
		Title:    "唯一标识",
		HTMLBody: "<p>" + randomText(t, 12*1024) + "</p>",
	}); err != nil {
		t.Fatalf("AddArticle() error = %v", err)
	}

	if _, err := p.Finish(context.Background()); err != nil {
		t.Fatalf("Finish() error = %v", err)
	}

	finished := p.finished[0]
	exactMeasured, err := measureArchiveSize(
		context.Background(),
		archiveMeta{
			title:    "Lantern 2026-03-15",
			identity: finished.identity,
			chapters: finished.chapters,
			images:   finished.images,
		},
		finished.entries,
		nil,
		64*1024,
	)
	if err != nil {
		t.Fatalf("measureArchiveSize() error = %v", err)
	}

	book, err := p.ReadBook(context.Background(), 0)
	if err != nil {
		t.Fatalf("ReadBook() error = %v", err)
	}

	if int64(len(book.Data)) != exactMeasured {
		t.Fatalf("final book len = %d, want exact measured size %d", len(book.Data), exactMeasured)
	}

	reader := openArchive(t, book.Data)
	ncx := string(entryBody(t, entryByName(t, reader, "OEBPS/toc.ncx")))
	opf := string(entryBody(t, entryByName(t, reader, "OEBPS/content.opf")))
	if !strings.Contains(ncx, finished.identity.identifier) {
		t.Fatalf("toc.ncx missing shared identifier %q:\n%s", finished.identity.identifier, ncx)
	}
	if !strings.Contains(opf, finished.identity.identifier) {
		t.Fatalf("content.opf missing shared identifier %q:\n%s", finished.identity.identifier, opf)
	}
	wantMod := finished.identity.modifiedAt.UTC().Format("2006-01-02T15:04:05Z")
	if !strings.Contains(opf, wantMod) {
		t.Fatalf("content.opf missing shared modifiedAt %q:\n%s", wantMod, opf)
	}
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
