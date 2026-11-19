package domain

import (
	"cmp"
	"slices"
)

const selectionDefaultRetention = 100

func PlanFeedSync(feedID string, sourceEntries []ParsedFeedEntry, storedItems []FeedItem, retention int, newID func() string) (newItems []FeedItem, deleteIDs []string) {
	limit := retention
	if limit < 1 {
		limit = selectionDefaultRetention
	}

	topEntries := dedupeTopEntries(sourceEntries, limit)
	retained, pending := planRetainedItems(topEntries, storedItems)
	newItems = buildNewFeedItems(feedID, pending, newID)

	fillRetainedItems(storedItems, retained, limit, len(newItems)+len(retained))
	deleteIDs = collectDeleteIDs(storedItems, retained)

	return newItems, deleteIDs
}

func dedupeTopEntries(entries []ParsedFeedEntry, limit int) []ParsedFeedEntry {
	top := make([]ParsedFeedEntry, 0, min(limit, len(entries)))
	seen := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		if len(top) >= limit {
			break
		}

		key := entry.URL.Raw()
		if _, ok := seen[key]; ok {
			continue
		}

		seen[key] = struct{}{}
		top = append(top, entry)
	}

	return top
}

func planRetainedItems(topEntries []ParsedFeedEntry, storedItems []FeedItem) (map[string]struct{}, []ParsedFeedEntry) {
	storedByURL := indexStoredByURL(storedItems)
	retained := make(map[string]struct{}, len(storedItems))
	pending := make([]ParsedFeedEntry, 0, len(topEntries))
	for _, entry := range topEntries {
		stored, ok := storedByURL[entry.URL.Raw()]
		if !ok {
			pending = append(pending, entry)
			continue
		}

		retained[stored.ID] = struct{}{}
	}

	return retained, pending
}

func indexStoredByURL(storedItems []FeedItem) map[string]FeedItem {
	storedByURL := make(map[string]FeedItem, len(storedItems))
	for _, item := range storedItems {
		if _, ok := storedByURL[item.URL.Raw()]; !ok {
			storedByURL[item.URL.Raw()] = item
		}
	}

	return storedByURL
}

func buildNewFeedItems(feedID string, pending []ParsedFeedEntry, newID func() string) []FeedItem {
	newItems := make([]FeedItem, len(pending))
	for i := len(pending) - 1; i >= 0; i-- {
		entry := pending[i]
		title, description, content := NormalizeArticleValues(entry.Title, entry.Description, entry.Content)
		newItems[i] = FeedItem{
			ID:          newID(),
			FeedID:      feedID,
			URL:         entry.URL,
			Title:       title,
			Description: description,
			Content:     content,
			PublishedAt: entry.PublishedAt,
		}
	}

	return newItems
}

func fillRetainedItems(storedItems []FeedItem, retained map[string]struct{}, limit int, total int) {
	if total >= limit {
		return
	}

	fillers := make([]FeedItem, 0, len(storedItems))
	for _, item := range storedItems {
		if _, ok := retained[item.ID]; ok {
			continue
		}

		fillers = append(fillers, item)
	}

	slices.SortFunc(fillers, func(a, b FeedItem) int {
		return cmp.Compare(b.ID, a.ID)
	})

	for _, item := range fillers {
		if total >= limit {
			break
		}

		retained[item.ID] = struct{}{}
		total++
	}
}

func collectDeleteIDs(storedItems []FeedItem, retained map[string]struct{}) []string {
	deleteIDs := make([]string, 0, len(storedItems))
	for _, item := range storedItems {
		if _, ok := retained[item.ID]; ok {
			continue
		}

		deleteIDs = append(deleteIDs, item.ID)
	}

	return deleteIDs
}
