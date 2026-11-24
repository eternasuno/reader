package epub

import (
	"archive/zip"
	"context"
	"errors"
	"reader/internal/domain"
	"slices"
	"strings"
	"testing"
	"time"
)

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

	if !strings.Contains(opf, "<dc:language>zh</dc:language>") || strings.Contains(opf, "zh-CN") {
		t.Fatalf("content.opf has incorrect language:\n%s", opf)
	}

	for _, name := range []string{"OEBPS/nav.xhtml", "OEBPS/chapters/chapter-0001.xhtml"} {
		body := string(entryBody(t, entryByName(t, reader, name)))
		if !strings.Contains(body, `xml:lang="zh" lang="zh"`) || strings.Contains(body, "zh-CN") {
			t.Fatalf("%s has incorrect language:\n%s", name, body)
		}
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
