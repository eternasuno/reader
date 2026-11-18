package domain

import (
	"strings"
	"testing"
)

func TestDecideKindleSplit(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name         string
		articleCount int
		encodedBytes int
		maxBytes     int
		textOnly     bool
		want         KindleSplitAction
	}{
		{name: "exactly at limit", articleCount: 1, encodedBytes: MaxKindleEPUBBytes, maxBytes: MaxKindleEPUBBytes, want: KindleActionAccept},
		{name: "one byte over single article", articleCount: 1, encodedBytes: MaxKindleEPUBBytes + 1, maxBytes: MaxKindleEPUBBytes, want: KindleActionRetryTextOnly},
		{name: "one byte over multiple articles", articleCount: 2, encodedBytes: MaxKindleEPUBBytes + 1, maxBytes: MaxKindleEPUBBytes, want: KindleActionSplitHalves},
		{name: "one byte over text only single article", articleCount: 1, encodedBytes: MaxKindleEPUBBytes + 1, maxBytes: MaxKindleEPUBBytes, textOnly: true, want: KindleActionFailOversize},
		{name: "default max accepts", articleCount: 1, encodedBytes: 1024, maxBytes: 0, want: KindleActionAccept},
		{name: "default max retries text only", articleCount: 1, encodedBytes: MaxKindleEPUBBytes + 1, maxBytes: -1, want: KindleActionRetryTextOnly},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			if got := DecideKindleSplit(tc.articleCount, tc.encodedBytes, tc.maxBytes, tc.textOnly); got != tc.want {
				t.Fatalf("DecideKindleSplit() = %q, want %q", got, tc.want)
			}
		})
	}
}

const kindleTestMB = 1024 * 1024

type kindleTestBook struct {
	IDs      []string
	TextOnly bool
}

func kindleTestBuilder(sizes map[string]int, textOnlyDivisor int) func([]KindleArticle, bool) (kindleTestBook, int, error) {
	return func(chunk []KindleArticle, textOnly bool) (kindleTestBook, int, error) {
		book := kindleTestBook{TextOnly: textOnly}
		total := 0
		for _, article := range chunk {
			book.IDs = append(book.IDs, article.ID)
			size := sizes[article.ID]
			if textOnly && textOnlyDivisor > 0 {
				size /= textOnlyDivisor
			}

			total += size
		}

		return book, total, nil
	}
}

func kindleTestArticles(ids ...string) []KindleArticle {
	articles := make([]KindleArticle, len(ids))
	for i, id := range ids {
		articles[i] = KindleArticle{ID: id, Title: id}
	}

	return articles
}

func TestSplitKindleChunksRecursesInBookOrder(t *testing.T) {
	t.Parallel()

	articles := kindleTestArticles("a1", "a2", "a3", "a4", "a5")
	sizes := map[string]int{"a1": 15 * kindleTestMB, "a2": 15 * kindleTestMB, "a3": 5 * kindleTestMB, "a4": 5 * kindleTestMB, "a5": 5 * kindleTestMB}

	books, err := SplitKindleChunks(articles, MaxKindleEPUBBytes, kindleTestBuilder(sizes, 0))
	if err != nil {
		t.Fatalf("SplitKindleChunks returned %v", err)
	}

	if len(books) != 3 {
		t.Fatalf("got %d books, want 3", len(books))
	}

	want := [][]string{{"a1"}, {"a2"}, {"a3", "a4", "a5"}}
	for i, wantIDs := range want {
		if strings.Join(books[i].IDs, ",") != strings.Join(wantIDs, ",") {
			t.Fatalf("book %d ids = %v, want %v", i, books[i].IDs, wantIDs)
		}

		if books[i].TextOnly {
			t.Fatalf("book %d should not be text only", i)
		}
	}
}

func TestSplitKindleChunksRetriesTextOnly(t *testing.T) {
	t.Parallel()

	articles := kindleTestArticles("a1")
	sizes := map[string]int{"a1": 30 * kindleTestMB}

	books, err := SplitKindleChunks(articles, MaxKindleEPUBBytes, kindleTestBuilder(sizes, 3))
	if err != nil {
		t.Fatalf("SplitKindleChunks returned %v", err)
	}

	if len(books) != 1 {
		t.Fatalf("got %d books, want 1", len(books))
	}

	if !books[0].TextOnly {
		t.Fatalf("expected a text-only book")
	}

	if strings.Join(books[0].IDs, ",") != "a1" {
		t.Fatalf("book ids = %v, want [a1]", books[0].IDs)
	}
}

func TestSplitKindleChunksFailsOversizeTextOnly(t *testing.T) {
	t.Parallel()

	articles := kindleTestArticles("a1")
	sizes := map[string]int{"a1": MaxKindleEPUBBytes + 1}

	books, err := SplitKindleChunks(articles, MaxKindleEPUBBytes, kindleTestBuilder(sizes, 0))
	if err == nil {
		t.Fatalf("expected an error, got books %v", books)
	}

	if books != nil {
		t.Fatalf("books = %v, want nil", books)
	}
}

func TestSplitKindleChunksEmpty(t *testing.T) {
	t.Parallel()

	books, err := SplitKindleChunks(nil, MaxKindleEPUBBytes, kindleTestBuilder(map[string]int{}, 0))
	if err != nil {
		t.Fatalf("SplitKindleChunks returned %v", err)
	}

	if len(books) != 0 {
		t.Fatalf("got %d books, want none", len(books))
	}
}

func TestHalveKindleArticlesAndFormatMeta(t *testing.T) {
	articles := []KindleArticle{
		{ID: "1", Title: "A1"},
		{ID: "2", Title: "A2"},
		{ID: "3", Title: "A3"},
		{ID: "4", Title: "A4"},
		{ID: "5", Title: "A5"},
	}

	left, right := HalveKindleArticles(articles)
	if len(left) != 2 || len(right) != 3 {
		t.Fatalf("expected 2 and 3, got %d and %d", len(left), len(right))
	}

	if left[0].ID != "1" || left[1].ID != "2" || right[0].ID != "3" || right[2].ID != "5" {
		t.Fatalf("unexpected article order after halving")
	}

	singleLeft, singleRight := HalveKindleArticles(articles[:1])
	if len(singleLeft) != 1 || singleRight != nil {
		t.Fatalf("expected single article not to split further")
	}

	title1, file1 := FormatKindleBookMeta("2026-11-18", 1, 1)
	if title1 != "留白 2026-11-18" || file1 != "liubai-2026-11-18.epub" {
		t.Fatalf("unexpected single book meta: %q, %q", title1, file1)
	}

	titleN, fileN := FormatKindleBookMeta("2026-11-18", 2, 3)
	if titleN != "留白 2026-11-18 (2/3)" || fileN != "liubai-2026-11-18-2.epub" {
		t.Fatalf("unexpected multi book meta: %q, %q", titleN, fileN)
	}
}
