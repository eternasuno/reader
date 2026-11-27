package epub

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"image/jpeg"
	"reader/internal/domain"
	"strings"
	"testing"
)

func TestNewBuilderDefaultsToEmbeddedCover(t *testing.T) {
	t.Parallel()

	builder := NewBuilder(Config{})
	if !bytes.Equal(builder.coverImage, coverJPEG) {
		t.Fatal("NewBuilder() cover image is not the embedded cover")
	}

	cfg, err := jpeg.DecodeConfig(bytes.NewReader(coverJPEG))
	if err != nil {
		t.Fatalf("embedded cover is not a JPEG: %v", err)
	}

	if cfg.Width != 1200 || cfg.Height != 1600 {
		t.Fatalf("embedded cover is %dx%d, want 1200x1600", cfg.Width, cfg.Height)
	}
}

func TestBuildBooksAddsCoverAndReadableTOC(t *testing.T) {
	t.Parallel()

	books, err := newTestBuilder(Config{}).BuildBooks(context.Background(), "2026-03-15", []domain.KindleArticle{
		{ID: "saved-1", IsSavedPage: true, Section: "Read Later", Title: "第一篇", HTMLBody: "<p>one</p>"},
	})
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	reader := openArchive(t, books[0].Data)

	cover := entryByName(t, reader, "OEBPS/images/cover.jpg")
	if cover.Method != zip.Store {
		t.Fatalf("cover.jpg method = %d, want %d", cover.Method, zip.Store)
	}

	if !bytes.Equal(entryBody(t, cover), testCoverImage) {
		t.Fatal("cover.jpg body differs from the configured cover image")
	}

	coverPage := entryBody(t, entryByName(t, reader, "OEBPS/cover.xhtml"))
	requireValidXML(t, "OEBPS/cover.xhtml", coverPage)
	if !strings.Contains(string(coverPage), `<img src="images/cover.jpg" alt="Lantern"/>`) {
		t.Fatalf("cover.xhtml missing cover image:\n%s", coverPage)
	}

	opf := string(entryBody(t, entryByName(t, reader, "OEBPS/content.opf")))
	wantOPF := []string{
		`<meta name="cover" content="cover-image"/>`,
		`<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>`,
		`<spine toc="ncx">` + "\n" + `<itemref idref="cover"/>` + "\n" + `<itemref idref="nav"/>` + "\n" + `<itemref idref="chapter-0001"/>`,
		`<reference type="text" title="正文" href="chapters/chapter-0001.xhtml"/>`,
	}
	for _, want := range wantOPF {
		if !strings.Contains(opf, want) {
			t.Fatalf("content.opf missing %q:\n%s", want, opf)
		}
	}

	nav := string(entryBody(t, entryByName(t, reader, "OEBPS/nav.xhtml")))
	if !strings.Contains(nav, `<nav epub:type="landmarks" id="landmarks" hidden="">`) {
		t.Fatalf("nav.xhtml missing landmarks:\n%s", nav)
	}
}

func TestBuildBooksGroupsChaptersIntoSections(t *testing.T) {
	t.Parallel()

	articles := []domain.KindleArticle{
		{ID: "saved-1", IsSavedPage: true, Section: "Read Later", Title: "稍后一", HTMLBody: "<p>a</p>"},
		{ID: "item-1", Section: "Tech & <News>", Title: "目录一", HTMLBody: "<p>b</p>"},
		{ID: "item-2", Section: "Tech & <News>", Title: "目录二", HTMLBody: "<p>c</p>"},
		{ID: "item-3", Section: "Solo Feed", Title: "订阅一", HTMLBody: "<p>d</p>"},
	}

	books, err := newTestBuilder(Config{}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	reader := openArchive(t, books[0].Data)
	navBytes := entryBody(t, entryByName(t, reader, "OEBPS/nav.xhtml"))
	requireValidXML(t, "OEBPS/nav.xhtml", navBytes)

	wantNav := `<ol>
<li><a href="chapters/chapter-0001.xhtml">Read Later</a>
<ol>
<li><a href="chapters/chapter-0001.xhtml">稍后一</a></li>
</ol></li>
<li><a href="chapters/chapter-0002.xhtml">Tech &amp; &lt;News&gt;</a>
<ol>
<li><a href="chapters/chapter-0002.xhtml">目录一</a></li>
<li><a href="chapters/chapter-0003.xhtml">目录二</a></li>
</ol></li>
<li><a href="chapters/chapter-0004.xhtml">Solo Feed</a>
<ol>
<li><a href="chapters/chapter-0004.xhtml">订阅一</a></li>
</ol></li>
</ol>`
	if !strings.Contains(string(navBytes), wantNav) {
		t.Fatalf("nav.xhtml sections = \n%s\nwant to contain\n%s", navBytes, wantNav)
	}

	ncxBytes := entryBody(t, entryByName(t, reader, "OEBPS/toc.ncx"))
	requireValidXML(t, "OEBPS/toc.ncx", ncxBytes)

	ncx := string(ncxBytes)
	wantNCX := `<navPoint id="section-0002" playOrder="2">
<navLabel><text>Tech &amp; &lt;News&gt;</text></navLabel>
<content src="chapters/chapter-0002.xhtml"/>
<navPoint id="navPoint-0002" playOrder="2">
<navLabel><text>目录一</text></navLabel>
<content src="chapters/chapter-0002.xhtml"/>
</navPoint>
<navPoint id="navPoint-0003" playOrder="3">
<navLabel><text>目录二</text></navLabel>
<content src="chapters/chapter-0003.xhtml"/>
</navPoint>
</navPoint>
`
	if !strings.Contains(ncx, wantNCX) || !strings.Contains(ncx, `<meta name="dtb:depth" content="2"/>`) {
		t.Fatalf("toc.ncx sections = \n%s\nwant to contain\n%s", ncx, wantNCX)
	}

	if got := strings.Count(ncx, `<navPoint id="section-`); got != 3 {
		t.Fatalf("toc.ncx section count = %d, want 3", got)
	}
}

func TestBuildBooksRepeatsSplitSectionInNextBook(t *testing.T) {
	t.Parallel()

	const (
		articleBytes = 100 * 1024
		maxBytes     = 200 * 1024
	)

	articles := make([]domain.KindleArticle, 3)
	for i := range articles {
		articles[i] = domain.KindleArticle{
			ID:       fmt.Sprintf("item-%d", i+1),
			Section:  "Tech",
			Title:    fmt.Sprintf("文章%d", i+1),
			HTMLBody: "<p>" + randomText(t, articleBytes) + "</p>",
		}
	}

	books, err := newTestBuilder(Config{MaxEPUBBytes: maxBytes}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	if len(books) != 2 {
		t.Fatalf("BuildBooks() returned %d books, want 2", len(books))
	}

	for i, book := range books {
		nav := string(entryBody(t, entryByName(t, openArchive(t, book.Data), "OEBPS/nav.xhtml")))
		want := `<li><a href="chapters/chapter-0001.xhtml">Tech</a>`
		if strings.Count(nav, want) != 1 || strings.Count(nav, ">Tech</a>") != 1 {
			t.Fatalf("books[%d] nav.xhtml should open section Tech once:\n%s", i, nav)
		}
	}
}

func TestPackerWritesFixedTextInPrimaryLanguage(t *testing.T) {
	t.Parallel()

	testCases := []struct {
		language domain.KindleLanguage
		wantText []string
	}{
		{language: domain.KindleLanguageChinese, wantText: []string{"<h1>目录</h1>", ">无标题<", ">原文链接</a>", `title="正文"`}},
		{language: domain.KindleLanguageEnglish, wantText: []string{"<h1>Contents</h1>", ">Untitled<", ">Original article</a>", `title="Start"`}},
		{language: domain.KindleLanguageJapanese, wantText: []string{"<h1>目次</h1>", ">無題<", ">元の記事</a>", `title="本文"`}},
	}

	for _, tc := range testCases {
		t.Run(string(tc.language), func(t *testing.T) {
			t.Parallel()

			ctx := context.Background()
			raw, err := newTestBuilder(Config{}).NewPacker(ctx, "", tc.language)
			if err != nil {
				t.Fatalf("NewPacker() error = %v", err)
			}
			defer func() { _ = raw.Close() }()

			if err := raw.AddArticle(ctx, domain.KindleArticle{ID: "a-1", Section: "S", URL: "https://example.com/a", HTMLBody: "<p>x</p>"}); err != nil {
				t.Fatalf("AddArticle() error = %v", err)
			}

			if _, err := raw.Finish(ctx); err != nil {
				t.Fatalf("Finish() error = %v", err)
			}

			book, err := raw.ReadBook(ctx, 0)
			if err != nil {
				t.Fatalf("ReadBook() error = %v", err)
			}

			reader := openArchive(t, book.Data)
			var all strings.Builder
			wantLang := `xml:lang="` + string(tc.language) + `" lang="` + string(tc.language) + `"`
			for _, name := range []string{"OEBPS/cover.xhtml", "OEBPS/nav.xhtml", "OEBPS/chapters/chapter-0001.xhtml"} {
				body := string(entryBody(t, entryByName(t, reader, name)))
				if !strings.Contains(body, wantLang) {
					t.Fatalf("%s missing %s:\n%s", name, wantLang, body)
				}

				all.WriteString(body)
			}

			opf := string(entryBody(t, entryByName(t, reader, "OEBPS/content.opf")))
			all.WriteString(opf)
			if !strings.Contains(opf, "<dc:language>"+string(tc.language)+"</dc:language>") {
				t.Fatalf("content.opf has wrong language:\n%s", opf)
			}

			for _, want := range tc.wantText {
				if !strings.Contains(all.String(), want) {
					t.Fatalf("book missing fixed text %q", want)
				}
			}
		})
	}
}

func TestNewPackerRejectsUnsupportedLanguage(t *testing.T) {
	t.Parallel()

	if _, err := newTestBuilder(Config{}).NewPacker(context.Background(), "", "fr"); err == nil {
		t.Fatal("NewPacker(fr) error = nil, want unsupported language error")
	}
}
