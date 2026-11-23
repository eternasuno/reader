package domain

import (
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"
)

func selectionTestURL(raw string) NormalizedURL {
	feedURL, err := ParseNormalizedURL(raw, ErrFeedUrlInvalid)
	if err != nil {
		panic(err)
	}

	return feedURL
}

func selectionTestID(value int) string {
	return fmt.Sprintf("id-%03d", value)
}

func selectionStoredRefs(letters []string) []StoredRef {
	refs := make([]StoredRef, len(letters))
	for i, letter := range letters {
		refs[i] = StoredRef{
			ID:  selectionTestID(len(letters) - i),
			URL: selectionTestURL("https://example.com/" + letter),
		}
	}

	return refs
}

func selectionStoredItems(letters []string) []FeedItem {
	items := make([]FeedItem, len(letters))
	for i, letter := range letters {
		items[i] = FeedItem{
			ID:     selectionTestID(len(letters) - i),
			FeedID: "feed-1",
			URL:    selectionTestURL("https://example.com/" + letter),
			Title:  strings.ToUpper(letter),
			Read:   i%2 == 1,
		}
	}

	return items
}

func selectionEntries(letters []string) []ParsedFeedEntry {
	entries := make([]ParsedFeedEntry, len(letters))
	for i, letter := range letters {
		entries[i] = ParsedFeedEntry{
			URL:   selectionTestURL("https://example.com/" + letter),
			Title: letter,
		}
	}

	return entries
}

func selectionLetter(t *testing.T, item FeedItem) string {
	t.Helper()

	raw := item.URL.Raw()
	index := strings.LastIndex(raw, "/")
	if index < 0 || index == len(raw)-1 {
		t.Fatalf("unexpected item url %q", raw)
	}

	return raw[index+1:]
}

func selectionCounter(start int) func() string {
	value := start

	return func() string {
		value++

		return selectionTestID(value)
	}
}

func selectionRetainedIDs(t *testing.T, stored []FeedItem, deleteIDs []string) map[string]struct{} {
	t.Helper()

	deleted := make(map[string]struct{}, len(deleteIDs))
	for _, id := range deleteIDs {
		if _, duplicate := deleted[id]; duplicate {
			t.Fatalf("duplicate delete id %q", id)
		}

		deleted[id] = struct{}{}
	}

	retained := make(map[string]struct{}, len(stored))
	for _, item := range stored {
		if _, ok := deleted[item.ID]; ok {
			continue
		}

		retained[item.ID] = struct{}{}
	}

	for id := range deleted {
		found := slices.ContainsFunc(stored, func(item FeedItem) bool { return item.ID == id })
		if !found {
			t.Fatalf("delete id %q does not belong to the stored items", id)
		}
	}

	return retained
}

func TestPlanFeedSyncSelectionKeepsPositionsAndPrunesOldest(t *testing.T) {
	cases := []struct {
		name   string
		stored string
		source string
		want   string
	}{
		{name: "empty stored", stored: "", source: "d c b a", want: "d c b"},
		{name: "newer source entry", stored: "d c b", source: "e d c b", want: "e d c"},
		{name: "single source entry", stored: "e d c", source: "f", want: "f e d"},
		{name: "reordered source", stored: "e d c", source: "c e d", want: "e d c"},
		{name: "inserted source entry", stored: "e d c", source: "e x d c", want: "x e d"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			stored := selectionStoredItems(strings.Fields(testCase.stored))
			refs := selectionStoredRefs(strings.Fields(testCase.stored))
			entries := selectionEntries(strings.Fields(testCase.source))
			newItems, deleteIDs := PlanFeedSync("feed-1", entries, refs, 3, selectionCounter(100))

			retained := selectionRetainedIDs(t, stored, deleteIDs)
			remaining := make([]FeedItem, 0, len(stored)+len(newItems))
			for _, item := range stored {
				if _, ok := retained[item.ID]; ok {
					remaining = append(remaining, item)
				}
			}

			remaining = append(remaining, newItems...)
			slices.SortFunc(remaining, func(a, b FeedItem) int {
				return strings.Compare(b.ID, a.ID)
			})

			letters := make([]string, len(remaining))
			for i, item := range remaining {
				letters[i] = selectionLetter(t, item)
			}

			got := strings.Join(letters, " ")
			if got != testCase.want {
				t.Fatalf("stored after sync = %q, want %q", got, testCase.want)
			}

			if len(remaining) > 3 {
				t.Fatalf("retained %d items, want at most 3", len(remaining))
			}
		})
	}
}

func TestPlanFeedSyncAssignsNewestFirstLargestIDs(t *testing.T) {
	published := time.Date(2026, time.January, 2, 3, 4, 5, 0, time.UTC)
	description := "  keep me  "
	blank := "   "
	entries := []ParsedFeedEntry{
		{URL: selectionTestURL("https://example.com/a"), Title: "  Alpha  ", Description: &description, Content: &blank, PublishedAt: &published},
		{URL: selectionTestURL("https://example.com/b"), Title: "   ", Description: &blank},
		{URL: selectionTestURL("https://example.com/c"), Title: "Gamma"},
	}

	newItems, deleteIDs := PlanFeedSync("feed-7", entries, nil, 5, selectionCounter(500))
	if len(deleteIDs) != 0 {
		t.Fatalf("deleteIDs = %v, want empty", deleteIDs)
	}

	if len(newItems) != 3 {
		t.Fatalf("got %d new items, want 3", len(newItems))
	}

	wantTitles := []string{"Alpha", "Untitled", "Gamma"}
	for i, item := range newItems {
		if item.Title != wantTitles[i] {
			t.Fatalf("newItems[%d].Title = %q, want %q", i, item.Title, wantTitles[i])
		}

		if item.FeedID != "feed-7" {
			t.Fatalf("newItems[%d].FeedID = %q, want %q", i, item.FeedID, "feed-7")
		}

		if item.Read {
			t.Fatalf("newItems[%d].Read = true, want false", i)
		}
	}

	for i := 1; i < len(newItems); i++ {
		if newItems[i-1].ID <= newItems[i].ID {
			t.Fatalf("ids are not newest first: %q then %q", newItems[i-1].ID, newItems[i].ID)
		}
	}

	if newItems[0].Description == nil || *newItems[0].Description != "keep me" {
		t.Fatalf("description = %v, want %q", newItems[0].Description, "keep me")
	}

	if newItems[0].Content != nil {
		t.Fatalf("content = %v, want nil", *newItems[0].Content)
	}

	if newItems[0].PublishedAt == nil || !newItems[0].PublishedAt.Equal(published) {
		t.Fatalf("publishedAt = %v, want %v", newItems[0].PublishedAt, published)
	}

	if newItems[1].Description != nil {
		t.Fatalf("blank description = %v, want nil", *newItems[1].Description)
	}

	if newItems[2].Content != nil || newItems[2].PublishedAt != nil {
		t.Fatalf("unexpected content/publishedAt on the last new item")
	}
}

func TestPlanFeedSyncKeepsFirstDuplicateSourceEntry(t *testing.T) {
	entries := []ParsedFeedEntry{
		{URL: selectionTestURL("https://example.com/d"), Title: "d-first"},
		{URL: selectionTestURL("https://example.com/d"), Title: "d-second"},
		{URL: selectionTestURL("https://example.com/c"), Title: "c"},
		{URL: selectionTestURL("https://example.com/b"), Title: "b"},
		{URL: selectionTestURL("https://example.com/a"), Title: "a"},
	}

	newItems, deleteIDs := PlanFeedSync("feed-1", entries, nil, 3, selectionCounter(100))
	if len(deleteIDs) != 0 {
		t.Fatalf("deleteIDs = %v, want empty", deleteIDs)
	}

	wantTitles := []string{"d-first", "c", "b"}
	if len(newItems) != len(wantTitles) {
		t.Fatalf("got %d new items, want %d", len(newItems), len(wantTitles))
	}

	for i, item := range newItems {
		if item.Title != wantTitles[i] {
			t.Fatalf("newItems[%d].Title = %q, want %q", i, item.Title, wantTitles[i])
		}
	}
}

func TestPlanFeedSyncIgnoresStoredItemsWhenListed(t *testing.T) {
	stored := []StoredRef{
		{ID: selectionTestID(3), URL: selectionTestURL("https://example.com/e")},
		{ID: selectionTestID(2), URL: selectionTestURL("https://example.com/d")},
	}
	entries := []ParsedFeedEntry{
		{URL: selectionTestURL("https://example.com/e"), Title: "source e"},
		{URL: selectionTestURL("https://example.com/d"), Title: "source d"},
	}

	newItems, deleteIDs := PlanFeedSync("feed-1", entries, stored, 5, selectionCounter(100))
	if len(newItems) != 0 {
		t.Fatalf("got %d new items, want none", len(newItems))
	}

	if len(deleteIDs) != 0 {
		t.Fatalf("deleteIDs = %v, want empty", deleteIDs)
	}
}

func TestPlanFeedSyncFallsBackToDefaultRetention(t *testing.T) {
	letters := make([]string, 150)
	for i := range letters {
		letters[i] = fmt.Sprintf("e%03d", i)
	}

	for _, retention := range []int{0, -5} {
		newItems, deleteIDs := PlanFeedSync("feed-1", selectionEntries(letters), nil, retention, selectionCounter(1000))
		if len(deleteIDs) != 0 {
			t.Fatalf("retention %d: deleteIDs = %v, want empty", retention, deleteIDs)
		}

		if len(newItems) != 100 {
			t.Fatalf("retention %d: got %d new items, want 100", retention, len(newItems))
		}

		if newItems[0].URL.Raw() != "https://example.com/e000" {
			t.Fatalf("retention %d: first url = %q", retention, newItems[0].URL.Raw())
		}

		if newItems[99].URL.Raw() != "https://example.com/e099" {
			t.Fatalf("retention %d: last url = %q", retention, newItems[99].URL.Raw())
		}
	}
}

func TestPlanFeedSyncDefaultRetentionPrunesStoredItems(t *testing.T) {
	stored := make([]StoredRef, 120)
	for i := range stored {
		stored[i] = StoredRef{
			ID:  selectionTestID(len(stored) - i),
			URL: selectionTestURL(fmt.Sprintf("https://example.com/s%03d", i)),
		}
	}

	newItems, deleteIDs := PlanFeedSync("feed-1", nil, stored, 0, selectionCounter(1000))
	if len(newItems) != 0 {
		t.Fatalf("got %d new items, want none", len(newItems))
	}

	if len(deleteIDs) != 20 {
		t.Fatalf("got %d delete ids, want 20", len(deleteIDs))
	}

	deleted := make(map[string]struct{}, len(deleteIDs))
	for _, id := range deleteIDs {
		deleted[id] = struct{}{}
	}

	retained := make(map[string]struct{}, len(stored))
	for _, ref := range stored {
		if _, ok := deleted[ref.ID]; !ok {
			retained[ref.ID] = struct{}{}
		}
	}
	if len(retained) != 100 {
		t.Fatalf("retained %d items, want 100", len(retained))
	}

	want := make(map[string]struct{}, 100)
	for i := 21; i <= 120; i++ {
		want[selectionTestID(i)] = struct{}{}
	}

	for id := range want {
		if _, ok := retained[id]; !ok {
			t.Fatalf("newest item %q was pruned", id)
		}
	}
}

func TestPlanFeedSyncRetentionIgnoresReadState(t *testing.T) {
	stored := []FeedItem{
		{ID: selectionTestID(3), FeedID: "feed-1", URL: selectionTestURL("https://example.com/e"), Title: "e", Read: true},
		{ID: selectionTestID(2), FeedID: "feed-1", URL: selectionTestURL("https://example.com/d"), Title: "d", Read: true},
		{ID: selectionTestID(1), FeedID: "feed-1", URL: selectionTestURL("https://example.com/c"), Title: "c"},
	}
	refs := []StoredRef{
		{ID: selectionTestID(3), URL: selectionTestURL("https://example.com/e")},
		{ID: selectionTestID(2), URL: selectionTestURL("https://example.com/d")},
		{ID: selectionTestID(1), URL: selectionTestURL("https://example.com/c")},
	}
	entries := []ParsedFeedEntry{{URL: selectionTestURL("https://example.com/f"), Title: "f"}}

	newItems, deleteIDs := PlanFeedSync("feed-1", entries, refs, 3, selectionCounter(100))
	if len(newItems) != 1 {
		t.Fatalf("got %d new items, want 1", len(newItems))
	}

	retained := selectionRetainedIDs(t, stored, deleteIDs)
	if _, ok := retained[selectionTestID(3)]; !ok {
		t.Fatalf("newest read item was pruned")
	}

	if _, ok := retained[selectionTestID(2)]; !ok {
		t.Fatalf("second read item was pruned")
	}

	if _, ok := retained[selectionTestID(1)]; ok {
		t.Fatalf("oldest unread item was retained, want pruned")
	}

	if len(deleteIDs) != 1 || deleteIDs[0] != selectionTestID(1) {
		t.Fatalf("deleteIDs = %v, want [%q]", deleteIDs, selectionTestID(1))
	}
}

func TestPlanFeedSyncPrunesUnlistedStoredItems(t *testing.T) {
	stored := selectionStoredRefs([]string{"e", "d", "c", "b", "a"})
	entries := selectionEntries([]string{"e", "d"})

	newItems, deleteIDs := PlanFeedSync("feed-1", entries, stored, 2, selectionCounter(100))
	if len(newItems) != 0 {
		t.Fatalf("got %d new items, want none", len(newItems))
	}

	wantDeleted := []string{selectionTestID(3), selectionTestID(2), selectionTestID(1)}
	if !slices.Equal(deleteIDs, wantDeleted) {
		t.Fatalf("deleteIDs = %v, want %v", deleteIDs, wantDeleted)
	}
}
