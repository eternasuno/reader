package epub

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"reader/internal/domain"
	"slices"
	"strings"
	"testing"
)

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

	numberedArticles := make([]domain.KindleArticle, 4)
	for i := range numberedArticles {
		numberedArticles[i] = domain.KindleArticle{
			ID: fmt.Sprintf("article-%d", i+1), URL: fmt.Sprintf("https://example.com/posts/%d", i+1),
			Title: fmt.Sprintf("第%d篇", i+1), HTMLBody: "<p>" + randomText(t, 48*1024) + "</p>",
		}
	}

	unnumbered, err := NewBuilder(Config{}).BuildBooks(context.Background(), "2026-03-15", numberedArticles[:2])
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name     string
		maxBytes int
		articles []domain.KindleArticle
	}{
		{"base", baseMaxBytes, articles},
		{"plus 7", baseMaxBytes + 7, articles},
		{"plus 513", baseMaxBytes + 513, articles},
		{"minus 4093", baseMaxBytes - 4093, articles},
		{"numbered title", len(unnumbered[0].Data) + 5, numberedArticles},
	} {
		t.Run(tc.name, func(t *testing.T) {
			maxBytes := tc.maxBytes
			books, err := NewBuilder(Config{MaxEPUBBytes: maxBytes}).BuildBooks(context.Background(), "2026-03-15", tc.articles)
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

			if packed != len(tc.articles) {
				t.Fatalf("maxBytes=%d packed = %d, want %d", maxBytes, packed, len(tc.articles))
			}
		})
	}
}

func TestPackerSharesBookIdentityBetweenMeasureAndFinalArchive(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	raw, err := NewBuilder(Config{MaxEPUBBytes: 64 * 1024}).NewPacker(ctx, "2026-03-15")
	if err != nil {
		t.Fatal(err)
	}
	p := raw.(*packer)
	defer func() { _ = p.Close() }()
	first := domain.KindleArticle{ID: "a-1", Title: "唯一标识", HTMLBody: "<p>first</p>"}
	if err := p.AddArticle(ctx, first); err != nil {
		t.Fatal(err)
	}
	identity := p.current.identity
	// Force the next candidate into the measurement margin while leaving ample room.
	p.builder.maxEPUBBytes = int(p.current.anchoredSize) + 1200
	before := p.measureCount
	if err := p.AddArticle(ctx, domain.KindleArticle{ID: "a-2", Title: "second", HTMLBody: "<p>second</p>"}); err != nil {
		t.Fatal(err)
	}
	if p.measureCount <= before {
		t.Fatal("candidate was not measured")
	}
	if _, err := p.Finish(ctx); err != nil {
		t.Fatal(err)
	}
	book, err := p.ReadBook(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	reader := openArchive(t, book.Data)
	ncx := string(entryBody(t, entryByName(t, reader, "OEBPS/toc.ncx")))
	opf := string(entryBody(t, entryByName(t, reader, "OEBPS/content.opf")))
	if !strings.Contains(ncx, identity.identifier) || !strings.Contains(opf, identity.identifier) {
		t.Fatalf("measured identity %q missing from OPF or NCX", identity.identifier)
	}
	wantMod := identity.modifiedAt.UTC().Format("2006-01-02T15:04:05Z")
	if !strings.Contains(opf, wantMod) {
		t.Fatalf("content.opf missing measured modifiedAt %q", wantMod)
	}
}
