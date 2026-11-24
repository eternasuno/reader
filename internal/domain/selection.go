package domain

const selectionDefaultRetention = 100

// PlanFeedSync selects new items and pruned IDs from storedRefs ordered newest first.
func PlanFeedSync(feedID string, sourceEntries []ParsedFeedEntry, storedRefs []StoredRef, retention int, newID func() string) (newItems []FeedItem, deleteIDs []string) {
	limit := retention
	if limit < 1 {
		limit = selectionDefaultRetention
	}

	topEntries := dedupeTopEntries(sourceEntries, limit)
	retained, pending := planRetainedItems(topEntries, storedRefs)
	newItems = buildNewFeedItems(feedID, pending, newID)
	deleteIDs = planPrunedIDs(storedRefs, retained, limit, len(newItems)+len(retained))

	return newItems, deleteIDs
}

func dedupeTopEntries(entries []ParsedFeedEntry, limit int) []ParsedFeedEntry {
	top := make([]ParsedFeedEntry, 0, min(limit, len(entries)))
	seen := make(map[string]struct{}, min(limit, len(entries)))
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

func planRetainedItems(topEntries []ParsedFeedEntry, storedRefs []StoredRef) (map[string]struct{}, []ParsedFeedEntry) {
	storedByURL := indexStoredByURL(storedRefs)
	retained := make(map[string]struct{}, min(len(topEntries), len(storedRefs)))
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

func indexStoredByURL(storedRefs []StoredRef) map[string]StoredRef {
	storedByURL := make(map[string]StoredRef, len(storedRefs))
	for _, ref := range storedRefs {
		if _, ok := storedByURL[ref.URL.Raw()]; !ok {
			storedByURL[ref.URL.Raw()] = ref
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

func planPrunedIDs(storedRefs []StoredRef, retained map[string]struct{}, limit int, total int) []string {
	deleteIDs := make([]string, 0)
	for _, ref := range storedRefs {
		if _, ok := retained[ref.ID]; ok {
			continue
		}

		if total < limit {
			total++

			continue
		}

		deleteIDs = append(deleteIDs, ref.ID)
	}

	return deleteIDs
}
