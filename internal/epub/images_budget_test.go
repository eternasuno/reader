package epub

import (
	"bytes"
	"context"
	"fmt"
	"reader/internal/domain"
	"strings"
	"testing"
	"time"
)

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

	books, err := newTestBuilder(Config{
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
	books, err := newTestBuilder(Config{
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

func TestPrepareImagesSkipsOversizedWithoutConsumingBookBudget(t *testing.T) {
	t.Parallel()

	img1 := encodeTestPNG(t, 95, 95) // ~36 KiB
	img2 := encodeTestPNG(t, 95, 95) // ~36 KiB (exceeds remaining ~14 KiB)
	img3 := encodeTestPNG(t, 32, 32) // ~4 KiB (fits in remaining ~14 KiB)
	if len(img1)+len(img2) <= 50*1024 || len(img1)+len(img3) > 50*1024 {
		t.Fatalf("unexpected fixture sizes: img1=%d img2=%d img3=%d", len(img1), len(img2), len(img3))
	}

	fetcher := newFakeImageFetcher(map[string]fakeImage{
		"https://example.com/1.png": {data: img1, mediaType: "image/png"},
		"https://example.com/2.png": {data: img2, mediaType: "image/png"},
		"https://example.com/3.png": {data: img3, mediaType: "image/png"},
	})

	books, err := newTestBuilder(Config{
		ImageFetcher:      fetcher,
		ImageConcurrency:  1,
		MaxEPUBBytes:      512 * 1024,
		MaxBookImageBytes: 50 * 1024,
	}).BuildBooks(context.Background(), "2026-03-15", []domain.KindleArticle{{
		ID:       "a-1",
		URL:      "https://example.com/posts/1",
		Title:    "预算顺序",
		HTMLBody: `<p>正文</p><img src="https://example.com/1.png"><img src="https://example.com/2.png"><img src="https://example.com/3.png">`,
	}})
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	reader := openArchive(t, books[0].Data)
	chapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0001.xhtml")))
	if strings.Count(chapter, "<img") != 2 {
		t.Fatalf("expected 2 images embedded (1.png and 3.png), got:\n%s", chapter)
	}

	if got := entryBody(t, entryByName(t, reader, "OEBPS/images/img-0001.png")); !bytes.Equal(got, img1) {
		t.Fatal("img-0001.png does not match img1")
	}

	if got := entryBody(t, entryByName(t, reader, "OEBPS/images/img-0002.png")); !bytes.Equal(got, img3) {
		t.Fatal("img-0002.png does not match img3")
	}
}

func TestPrepareImagesBookBudgetRejectionDoesNotPoisonLaterBook(t *testing.T) {
	t.Parallel()

	img1 := encodeTestPNG(t, 95, 95)        // ~36 KiB
	img2 := encodeTestPNG(t, 95, 95)        // ~36 KiB (exceeds remaining in book 1, fits book 2)
	oversized := encodeTestPNG(t, 120, 120) // ~57 KiB (exceeds the entire book budget)
	if len(img1)+len(img2) <= 50*1024 || len(img2) > 50*1024 || len(oversized) <= 50*1024 {
		t.Fatalf("unexpected fixture sizes: img1=%d img2=%d oversized=%d", len(img1), len(img2), len(oversized))
	}

	fetcher := newFakeImageFetcher(map[string]fakeImage{
		"https://example.com/1.png":         {data: img1, mediaType: "image/png"},
		"https://example.com/2.png":         {data: img2, mediaType: "image/png"},
		"https://example.com/oversized.png": {data: oversized, mediaType: "image/png"},
	})

	articles := []domain.KindleArticle{
		{
			ID:       "a-1",
			URL:      "https://example.com/posts/1",
			Title:    "第一篇",
			HTMLBody: "<p>" + randomText(t, 55*1024) + `</p><img src="https://example.com/1.png"><img src="https://example.com/2.png"><img src="https://example.com/oversized.png">`,
		},
		{
			ID:       "a-2",
			URL:      "https://example.com/posts/2",
			Title:    "第二篇",
			HTMLBody: "<p>" + randomText(t, 55*1024) + `</p><img src="https://example.com/2.png"><img src="https://example.com/oversized.png">`,
		},
	}

	books, err := newTestBuilder(Config{
		ImageFetcher:      fetcher,
		ImageConcurrency:  1,
		MaxEPUBBytes:      96 * 1024,
		MaxBookImageBytes: 50 * 1024,
	}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	if len(books) != 2 {
		t.Fatalf("BuildBooks() returned %d books, want 2", len(books))
	}

	for _, tt := range []struct {
		url  string
		want int
	}{
		{url: "https://example.com/oversized.png", want: 1},
		{url: "https://example.com/2.png", want: 3},
	} {
		if got := fetcher.callCount(tt.url); got != tt.want {
			t.Errorf("FetchImage(%q) called %d times, want %d", tt.url, got, tt.want)
		}
	}

	reader1 := openArchive(t, books[0].Data)
	ch1 := string(entryBody(t, entryByName(t, reader1, "OEBPS/chapters/chapter-0001.xhtml")))
	if strings.Count(ch1, "<img") != 1 {
		t.Fatalf("book 1 chapter embedded %d images, want 1:\n%s", strings.Count(ch1, "<img"), ch1)
	}

	reader2 := openArchive(t, books[1].Data)
	ch2 := string(entryBody(t, entryByName(t, reader2, "OEBPS/chapters/chapter-0001.xhtml")))
	if strings.Count(ch2, "<img") != 1 || !strings.Contains(ch2, `src="../images/img-0001.png"`) {
		t.Fatalf("book 2 expected 2.png embedded, got:\n%s", ch2)
	}
}
