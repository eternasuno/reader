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

	topEntries := selectionTopEntries(sourceEntries, limit)
	storedByURL := make(map[string]FeedItem, len(storedItems))
	for _, item := range storedItems {
		if _, ok := storedByURL[item.URL.Raw()]; !ok {
			storedByURL[item.URL.Raw()] = item
		}
	}

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

	newItems = make([]FeedItem, len(pending))
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

	total := len(newItems) + len(retained)
	if total < limit {
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

	deleteIDs = make([]string, 0, len(storedItems))
	for _, item := range storedItems {
		if _, ok := retained[item.ID]; ok {
			continue
		}

		deleteIDs = append(deleteIDs, item.ID)
	}

	return newItems, deleteIDs
}

func selectionTopEntries(entries []ParsedFeedEntry, limit int) []ParsedFeedEntry {
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
