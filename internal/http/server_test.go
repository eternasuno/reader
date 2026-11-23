package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"reader/internal/domain"
)

const (
	testAppURL   = "https://reader.example.com"
	testPassword = "correct horse battery staple"
)

func strPtr(value string) *string {
	return &value
}

type testClock struct {
	mu      sync.Mutex
	current time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()

	return c.current
}

func (c *testClock) Advance(delta time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.current = c.current.Add(delta)
}

type fakeStore struct {
	folders  []domain.Folder
	feeds    []domain.Feed
	items    []domain.FeedItem
	saved    []domain.SavedPage
	settings domain.Settings
	sends    []domain.KindleSendRecord

	savedPagesErr error
}

func (s *fakeStore) folderIndex(id string) int {
	for i, folder := range s.folders {
		if folder.ID == id {
			return i
		}
	}

	return -1
}

func (s *fakeStore) feedIndex(id string) int {
	for i, feed := range s.feeds {
		if feed.ID == id {
			return i
		}
	}

	return -1
}

func (s *fakeStore) itemIndex(id string) int {
	for i, item := range s.items {
		if item.ID == id {
			return i
		}
	}

	return -1
}

func (s *fakeStore) savedIndex(id string) int {
	for i, page := range s.saved {
		if page.ID == id {
			return i
		}
	}

	return -1
}

func pageByID[T any](source []T, params domain.PageParams, idOf func(T) string) domain.PageResult[T] {
	sorted := make([]T, len(source))
	copy(sorted, source)

	newestFirst := params.Order != domain.SortOrderOldest
	sort.Slice(sorted, func(i, j int) bool {
		if newestFirst {
			return idOf(sorted[i]) > idOf(sorted[j])
		}

		return idOf(sorted[i]) < idOf(sorted[j])
	})

	start := 0
	if params.Cursor != nil {
		for start < len(sorted) {
			id := idOf(sorted[start])
			if (newestFirst && id < *params.Cursor) || (!newestFirst && id > *params.Cursor) {
				break
			}

			start++
		}
	}

	end := start + params.Limit
	if end > len(sorted) {
		end = len(sorted)
	}

	page := make([]T, 0, end-start)
	page = append(page, sorted[start:end]...)

	var cursor *string
	if end < len(sorted) && len(page) > 0 {
		last := idOf(page[len(page)-1])
		cursor = &last
	}

	return domain.PageResult[T]{Items: page, Cursor: cursor}
}

func (s *fakeStore) ListFolders() ([]domain.Folder, error) {
	folders := make([]domain.Folder, len(s.folders))
	copy(folders, s.folders)

	sort.Slice(folders, func(i, j int) bool {
		if folders[i].Name != folders[j].Name {
			return folders[i].Name < folders[j].Name
		}

		return folders[i].ID < folders[j].ID
	})

	return folders, nil
}

func (s *fakeStore) folderByID(id string) *domain.Folder {
	index := s.folderIndex(id)
	if index < 0 {
		return nil
	}

	folder := s.folders[index]

	return &folder
}

func (s *fakeStore) CreateFolder(id string, name string) (domain.Folder, error) {
	for _, folder := range s.folders {
		if folder.Name == name {
			return domain.Folder{}, domain.NewError(domain.ErrFolderAlreadyExists, nil)
		}
	}

	folder := domain.Folder{ID: id, Name: name}
	s.folders = append(s.folders, folder)

	return folder, nil
}

func (s *fakeStore) RenameFolder(id string, name string) error {
	index := s.folderIndex(id)
	if index < 0 {
		return domain.NewError(domain.ErrFolderNotFound, nil)
	}

	for _, folder := range s.folders {
		if folder.Name == name && folder.ID != id {
			return domain.NewError(domain.ErrFolderAlreadyExists, nil)
		}
	}

	s.folders[index].Name = name

	return nil
}

func (s *fakeStore) DeleteFolder(id string) error {
	index := s.folderIndex(id)
	if index < 0 {
		return nil
	}

	s.folders = append(s.folders[:index], s.folders[index+1:]...)
	for i := range s.feeds {
		if s.feeds[i].FolderID != nil && *s.feeds[i].FolderID == id {
			s.feeds[i].FolderID = nil
		}
	}

	return nil
}

func (s *fakeStore) feedByID(id string) *domain.Feed {
	index := s.feedIndex(id)
	if index < 0 {
		return nil
	}

	feed := s.feeds[index]

	return &feed
}

func (s *fakeStore) CreateFeed(feed domain.Feed) (domain.Feed, error) {
	if feed.FolderID != nil && s.folderIndex(*feed.FolderID) < 0 {
		return domain.Feed{}, domain.NewError(domain.ErrFolderNotFound, nil)
	}

	for _, existing := range s.feeds {
		if existing.URL.Raw() == feed.URL.Raw() {
			return domain.Feed{}, domain.NewConflictURL(domain.ErrFeedAlreadyExists, feed.URL.RedactedString())
		}
	}

	s.feeds = append(s.feeds, feed)

	return feed, nil
}

func (s *fakeStore) DeleteFeed(id string) error {
	if index := s.feedIndex(id); index >= 0 {
		s.feeds = append(s.feeds[:index], s.feeds[index+1:]...)
	}

	kept := make([]domain.FeedItem, 0, len(s.items))
	for _, item := range s.items {
		if item.FeedID != id {
			kept = append(kept, item)
		}
	}

	s.items = kept

	return nil
}

func (s *fakeStore) UpdateReaderMode(id string, mode domain.ReaderMode) error {
	if index := s.feedIndex(id); index >= 0 {
		s.feeds[index].ReaderMode = mode
	}

	return nil
}

func (s *fakeStore) UpdateOrder(id string, order domain.SortOrder) error {
	if index := s.feedIndex(id); index >= 0 {
		s.feeds[index].Order = order
	}

	return nil
}

func (s *fakeStore) MoveToFolder(id string, folderID *string) error {
	if folderID != nil && s.folderIndex(*folderID) < 0 {
		return domain.NewError(domain.ErrFolderNotFound, nil)
	}

	if index := s.feedIndex(id); index >= 0 {
		s.feeds[index].FolderID = folderID
	}

	return nil
}

func (s *fakeStore) ImportOPML(doc domain.OPMLDocument) (domain.OPMLImportResult, []string, error) {
	result := domain.OPMLImportResult{SkippedFeeds: doc.SkippedInvalid}
	folderIDs := make(map[string]string, len(s.folders))
	for _, folder := range s.folders {
		folderIDs[folder.Name] = folder.ID
	}

	knownFeeds := make(map[string]struct{}, len(s.feeds))
	for _, feed := range s.feeds {
		knownFeeds[feed.URL.Raw()] = struct{}{}
	}

	newIDs := make([]string, 0, len(doc.Feeds))
	for _, input := range doc.Feeds {
		if _, duplicate := knownFeeds[input.URL.Raw()]; duplicate {
			result.SkippedFeeds++

			continue
		}

		var folderID *string
		if input.FolderName != nil {
			id, exists := folderIDs[*input.FolderName]
			if !exists {
				id = domain.NewID()
				s.folders = append(s.folders, domain.Folder{ID: id, Name: *input.FolderName})
				folderIDs[*input.FolderName] = id
				result.CreatedFolders++
			}

			folderID = &id
		}

		feedID := domain.NewID()
		s.feeds = append(s.feeds, domain.Feed{
			ID:         feedID,
			URL:        input.URL,
			Title:      input.Title,
			FolderID:   folderID,
			ReaderMode: domain.ReaderModeDefault,
			Order:      domain.SortOrderNewest,
		})
		knownFeeds[input.URL.Raw()] = struct{}{}
		newIDs = append(newIDs, feedID)
		result.ImportedFeeds++
	}

	return result, newIDs, nil
}

func (s *fakeStore) ListFeeds() ([]domain.Feed, error) {
	feeds := make([]domain.Feed, len(s.feeds))
	copy(feeds, s.feeds)

	sort.Slice(feeds, func(i, j int) bool {
		if feeds[i].Title != feeds[j].Title {
			return feeds[i].Title < feeds[j].Title
		}

		return feeds[i].ID < feeds[j].ID
	})

	return feeds, nil
}

func (s *fakeStore) ListSavedPages(params domain.PageParams) (domain.PageResult[domain.SavedPage], error) {
	if s.savedPagesErr != nil {
		return domain.PageResult[domain.SavedPage]{}, s.savedPagesErr
	}

	filtered := make([]domain.SavedPage, 0, len(s.saved))
	for _, page := range s.saved {
		if params.Unread && page.Read {
			continue
		}

		filtered = append(filtered, page)
	}

	return pageByID(filtered, params, func(page domain.SavedPage) string { return page.ID }), nil
}

func (s *fakeStore) savedByID(id string) *domain.SavedPage {
	index := s.savedIndex(id)
	if index < 0 {
		return nil
	}

	page := s.saved[index]

	return &page
}

func (s *fakeStore) savedByURL(url domain.NormalizedURL) *domain.SavedPage {
	for i := range s.saved {
		if s.saved[i].URL.Raw() == url.Raw() {
			page := s.saved[i]

			return &page
		}
	}

	return nil
}

func (s *fakeStore) CreateSavedPage(page domain.SavedPage) (domain.SavedPage, error) {
	if existing := s.savedByURL(page.URL); existing != nil {
		return domain.SavedPage{}, domain.NewConflictURL(domain.ErrSavedPageAlreadyExists, page.URL.RedactedString())
	}

	s.saved = append(s.saved, page)

	return page, nil
}

func (s *fakeStore) SetSavedPageRead(id string, read bool) error {
	if index := s.savedIndex(id); index >= 0 {
		s.saved[index].Read = read
	}

	return nil
}

func (s *fakeStore) itemList(params domain.PageParams, include func(domain.FeedItem) bool) domain.PageResult[domain.FeedItem] {
	filtered := make([]domain.FeedItem, 0, len(s.items))
	for _, item := range s.items {
		if include != nil && !include(item) {
			continue
		}

		if params.Unread && item.Read {
			continue
		}

		filtered = append(filtered, item)
	}

	return pageByID(filtered, params, func(item domain.FeedItem) string { return item.ID })
}

func (s *fakeStore) feedItemByID(id string) *domain.FeedItem {
	index := s.itemIndex(id)
	if index < 0 {
		return nil
	}

	item := s.items[index]

	return &item
}

func (s *fakeStore) markItems(predicate func(domain.FeedItem) bool) {
	for i := range s.items {
		if predicate(s.items[i]) {
			s.items[i].Read = true
		}
	}
}

// Repository doubles. Each one wraps the shared fakeStore state and satisfies a
// single domain port, since Go cannot overload same-named methods.

type fakeFolderRepo struct {
	store *fakeStore
}

func (r *fakeFolderRepo) List(ctx context.Context) ([]domain.Folder, error) {
	return r.store.ListFolders()
}

func (r *fakeFolderRepo) GetByID(ctx context.Context, id string) (*domain.Folder, error) {
	return r.store.folderByID(id), nil
}

func (r *fakeFolderRepo) Create(ctx context.Context, id string, name string) (domain.Folder, error) {
	return r.store.CreateFolder(id, name)
}

func (r *fakeFolderRepo) Rename(ctx context.Context, id string, name string) error {
	return r.store.RenameFolder(id, name)
}

func (r *fakeFolderRepo) Delete(ctx context.Context, id string) error {
	return r.store.DeleteFolder(id)
}

type fakeFeedRepo struct {
	store *fakeStore
}

func (r *fakeFeedRepo) List(ctx context.Context) ([]domain.Feed, error) {
	return r.store.ListFeeds()
}

func (r *fakeFeedRepo) GetByID(ctx context.Context, id string) (*domain.Feed, error) {
	return r.store.feedByID(id), nil
}

func (r *fakeFeedRepo) GetByURL(ctx context.Context, url domain.NormalizedURL) (*domain.Feed, error) {
	for i := range r.store.feeds {
		if r.store.feeds[i].URL.Raw() == url.Raw() {
			feed := r.store.feeds[i]

			return &feed, nil
		}
	}

	return nil, nil
}

func (r *fakeFeedRepo) Create(ctx context.Context, feed domain.Feed) (domain.Feed, error) {
	return r.store.CreateFeed(feed)
}

func (r *fakeFeedRepo) Delete(ctx context.Context, id string) error {
	return r.store.DeleteFeed(id)
}

func (r *fakeFeedRepo) UpdateReaderMode(ctx context.Context, id string, mode domain.ReaderMode) error {
	return r.store.UpdateReaderMode(id, mode)
}

func (r *fakeFeedRepo) UpdateOrder(ctx context.Context, id string, order domain.SortOrder) error {
	return r.store.UpdateOrder(id, order)
}

func (r *fakeFeedRepo) MoveToFolder(ctx context.Context, id string, folderID *string) error {
	return r.store.MoveToFolder(id, folderID)
}

func (r *fakeFeedRepo) RecordRefreshFailure(ctx context.Context, id string, errSummary string) error {
	return nil
}

func (r *fakeFeedRepo) ApplySync(ctx context.Context, feedID string, newTitle string, updatedAt time.Time, newItems []domain.FeedItem, deleteIDs []string) error {
	return nil
}

func (r *fakeFeedRepo) ImportOPML(ctx context.Context, doc domain.OPMLDocument) (domain.OPMLImportResult, []string, error) {
	return r.store.ImportOPML(doc)
}

type fakeFeedItemRepo struct {
	store *fakeStore
}

func (r *fakeFeedItemRepo) ListAll(ctx context.Context, params domain.PageParams) (domain.PageResult[domain.FeedItem], error) {
	return r.store.itemList(params, nil), nil
}

func (r *fakeFeedItemRepo) ListByFeed(ctx context.Context, feedID string, params domain.PageParams) (domain.PageResult[domain.FeedItem], error) {
	return r.store.itemList(params, func(item domain.FeedItem) bool { return item.FeedID == feedID }), nil
}

func (r *fakeFeedItemRepo) ListByFolder(ctx context.Context, folderID string, params domain.PageParams) (domain.PageResult[domain.FeedItem], error) {
	inFolder := make(map[string]struct{})
	for _, feed := range r.store.feeds {
		if feed.FolderID != nil && *feed.FolderID == folderID {
			inFolder[feed.ID] = struct{}{}
		}
	}

	return r.store.itemList(params, func(item domain.FeedItem) bool {
		_, ok := inFolder[item.FeedID]

		return ok
	}), nil
}

func (r *fakeFeedItemRepo) ListByFeedForRetention(ctx context.Context, feedID string) ([]domain.FeedItem, error) {
	items := make([]domain.FeedItem, 0, len(r.store.items))
	for _, item := range r.store.items {
		if item.FeedID == feedID {
			items = append(items, item)
		}
	}

	return items, nil
}

func (r *fakeFeedItemRepo) GetByID(ctx context.Context, id string) (*domain.FeedItem, error) {
	return r.store.feedItemByID(id), nil
}

func (r *fakeFeedItemRepo) UnreadCounts(ctx context.Context) ([]domain.FeedUnreadCount, error) {
	counts := make([]domain.FeedUnreadCount, 0, len(r.store.feeds))
	for _, feed := range r.store.feeds {
		unread := 0
		for _, item := range r.store.items {
			if item.FeedID == feed.ID && !item.Read {
				unread++
			}
		}

		if unread > 0 {
			counts = append(counts, domain.FeedUnreadCount{FeedID: feed.ID, Count: unread})
		}
	}

	return counts, nil
}

func (r *fakeFeedItemRepo) SetRead(ctx context.Context, id string, read bool) error {
	if index := r.store.itemIndex(id); index >= 0 {
		r.store.items[index].Read = read
	}

	return nil
}

func (r *fakeFeedItemRepo) MarkIDsRead(ctx context.Context, ids []string) error {
	selected := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		selected[id] = struct{}{}
	}

	r.store.markItems(func(item domain.FeedItem) bool {
		_, ok := selected[item.ID]

		return ok
	})

	return nil
}

func (r *fakeFeedItemRepo) MarkAllRead(ctx context.Context) error {
	r.store.markItems(func(domain.FeedItem) bool { return true })

	return nil
}

func (r *fakeFeedItemRepo) MarkFeedRead(ctx context.Context, feedID string) error {
	r.store.markItems(func(item domain.FeedItem) bool { return item.FeedID == feedID })

	return nil
}

func (r *fakeFeedItemRepo) MarkFolderRead(ctx context.Context, folderID string) error {
	feedIDs := make(map[string]struct{})
	for _, feed := range r.store.feeds {
		if feed.FolderID != nil && *feed.FolderID == folderID {
			feedIDs[feed.ID] = struct{}{}
		}
	}

	r.store.markItems(func(item domain.FeedItem) bool {
		_, ok := feedIDs[item.FeedID]

		return ok
	})

	return nil
}

func (r *fakeFeedItemRepo) SaveExtractedContent(ctx context.Context, id string, content string) (*domain.FeedItem, error) {
	index := r.store.itemIndex(id)
	if index < 0 {
		return nil, nil
	}

	r.store.items[index].ExtractedContent = &content
	item := r.store.items[index]

	return &item, nil
}

type fakeSavedPageRepo struct {
	store *fakeStore
}

func (r *fakeSavedPageRepo) List(ctx context.Context, params domain.PageParams) (domain.PageResult[domain.SavedPage], error) {
	return r.store.ListSavedPages(params)
}

func (r *fakeSavedPageRepo) UnreadCount(ctx context.Context) (int, error) {
	if r.store.savedPagesErr != nil {
		return 0, r.store.savedPagesErr
	}

	unread := 0
	for _, page := range r.store.saved {
		if !page.Read {
			unread++
		}
	}

	return unread, nil
}

func (r *fakeSavedPageRepo) GetByID(ctx context.Context, id string) (*domain.SavedPage, error) {
	return r.store.savedByID(id), nil
}

func (r *fakeSavedPageRepo) GetByURL(ctx context.Context, url domain.NormalizedURL) (*domain.SavedPage, error) {
	return r.store.savedByURL(url), nil
}

func (r *fakeSavedPageRepo) Create(ctx context.Context, page domain.SavedPage) (domain.SavedPage, error) {
	return r.store.CreateSavedPage(page)
}

func (r *fakeSavedPageRepo) SetRead(ctx context.Context, id string, read bool) error {
	return r.store.SetSavedPageRead(id, read)
}

func (r *fakeSavedPageRepo) MarkIDsRead(ctx context.Context, ids []string) error {
	selected := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		selected[id] = struct{}{}
	}

	for i := range r.store.saved {
		if _, ok := selected[r.store.saved[i].ID]; ok {
			r.store.saved[i].Read = true
		}
	}

	return nil
}

func (r *fakeSavedPageRepo) MarkAllRead(ctx context.Context) error {
	for i := range r.store.saved {
		r.store.saved[i].Read = true
	}

	return nil
}

func (r *fakeSavedPageRepo) Delete(ctx context.Context, id string) error {
	if index := r.store.savedIndex(id); index >= 0 {
		r.store.saved = append(r.store.saved[:index], r.store.saved[index+1:]...)
	}

	return nil
}

type fakeSettingRepo struct {
	store *fakeStore
}

func (r *fakeSettingRepo) Get(ctx context.Context) (domain.Settings, error) {
	return r.store.settings, nil
}

func (r *fakeSettingRepo) UpdateRetention(ctx context.Context, retention int) error {
	r.store.settings.Retention = retention

	return nil
}

func (r *fakeSettingRepo) UpdateProvider(ctx context.Context, provider domain.ExtractorProvider) error {
	if provider == domain.ProviderBrowser {
		stored := r.store.settings.BrowserEndpoint
		if stored == nil || strings.TrimSpace(*stored) == "" {
			return domain.NewError(domain.ErrBrowserEndpointRequired, nil)
		}
	}

	r.store.settings.Provider = provider

	return nil
}

func (r *fakeSettingRepo) UpdateJinaKey(ctx context.Context, key string) error {
	trimmed := strings.TrimSpace(key)
	r.store.settings.JinaKey = &trimmed

	return nil
}

func (r *fakeSettingRepo) DeleteJinaKey(ctx context.Context) error {
	r.store.settings.JinaKey = nil

	return nil
}

func (r *fakeSettingRepo) UpdateBrowserEndpoint(ctx context.Context, endpoint string) error {
	trimmed := strings.TrimSpace(endpoint)
	r.store.settings.BrowserEndpoint = &trimmed

	return nil
}

func (r *fakeSettingRepo) DeleteBrowserEndpoint(ctx context.Context) error {
	r.store.settings.BrowserEndpoint = nil
	if r.store.settings.Provider == domain.ProviderBrowser {
		r.store.settings.Provider = domain.ProviderDirect
	}

	return nil
}

func (r *fakeSettingRepo) UpdateSMTP(ctx context.Context, smtp domain.SMTPSettings) error {
	stored := smtp
	if smtp.Password == nil || strings.TrimSpace(*smtp.Password) == "" {
		if r.store.settings.SMTP != nil {
			stored.Password = r.store.settings.SMTP.Password
		} else {
			stored.Password = nil
		}
	}

	r.store.settings.SMTP = &stored

	return nil
}

func (r *fakeSettingRepo) DeleteSMTPPassword(ctx context.Context) error {
	if r.store.settings.SMTP != nil {
		r.store.settings.SMTP.Password = nil
	}

	return nil
}

func (r *fakeSettingRepo) DeleteSMTP(ctx context.Context) error {
	r.store.settings.SMTP = nil

	return nil
}

func (r *fakeSettingRepo) UpdateKindle(ctx context.Context, kindle domain.KindleSettings) error {
	if r.store.settings.SMTP == nil {
		return domain.NewError(domain.ErrSMTPNotConfigured, nil)
	}

	stored := kindle
	r.store.settings.Kindle = &stored

	return nil
}

func (r *fakeSettingRepo) AdvanceNextSendAt(ctx context.Context, nextSendAt time.Time) error {
	if r.store.settings.Kindle != nil {
		r.store.settings.Kindle.NextSendAt = &nextSendAt
	}

	return nil
}

type fakeKindleSendRepo struct {
	store *fakeStore
}

func (r *fakeKindleSendRepo) RecoverRunningOnStartup(ctx context.Context, now time.Time) error {
	return nil
}

func (r *fakeKindleSendRepo) ListRecent(ctx context.Context) ([]domain.KindleSendRecord, error) {
	records := make([]domain.KindleSendRecord, len(r.store.sends))
	copy(records, r.store.sends)

	return records, nil
}

func (r *fakeKindleSendRepo) CreateRunning(ctx context.Context, record domain.KindleSendRecord) (domain.KindleSendRecord, error) {
	r.store.sends = append([]domain.KindleSendRecord{record}, r.store.sends...)

	return record, nil
}

func (r *fakeKindleSendRepo) ListUnreadForKindle(ctx context.Context) ([]domain.SavedPage, []domain.Feed, map[string][]domain.FeedItem, error) {
	return nil, nil, nil, nil
}

func (r *fakeKindleSendRepo) RecordBookAccepted(ctx context.Context, sendID string, savedPageIDs []string, feedItemIDs []string, articleDelta int) error {
	return nil
}

func (r *fakeKindleSendRepo) CompleteSend(ctx context.Context, sendID string, status domain.KindleStatus, errSummary *string, finishedAt time.Time) error {
	return nil
}

// fakeFetchers are the adapter doubles used by the HTTP handlers.

type fakeFeedFetcher struct {
	body     []byte
	finalURL string
	err      error
	calls    int
}

func (f *fakeFeedFetcher) FetchFeed(ctx context.Context, url domain.NormalizedURL) ([]byte, string, error) {
	f.calls++
	if f.err != nil {
		return nil, "", f.err
	}

	return f.body, f.finalURL, nil
}

type fakeWebpageFetcher struct {
	html     string
	finalURL string
	err      error
	calls    int
	lastURL  string
}

func (f *fakeWebpageFetcher) FetchWebpage(ctx context.Context, url domain.NormalizedURL) (string, string, error) {
	f.calls++
	f.lastURL = url.Raw()
	if f.err != nil {
		return "", "", f.err
	}

	return f.html, f.finalURL, nil
}

type fakeFeedParser struct {
	parsed domain.ParsedFeed
	err    error
}

func (f *fakeFeedParser) ParseFeed(body []byte, baseURL string) (domain.ParsedFeed, error) {
	if f.err != nil {
		return domain.ParsedFeed{}, f.err
	}

	return f.parsed, nil
}

type fakeArticleExtractor struct {
	article  domain.ExtractedArticle
	err      error
	lastHTML string
	lastURL  string
	calls    int
}

func (f *fakeArticleExtractor) ExtractArticle(htmlBody string, pageURL string) (domain.ExtractedArticle, error) {
	f.calls++
	f.lastHTML = htmlBody
	f.lastURL = pageURL
	if f.err != nil {
		return domain.ExtractedArticle{}, f.err
	}

	return f.article, nil
}

type fakeRefresher struct {
	batches [][]string
}

func (f *fakeRefresher) Enqueue(feedIDs ...string) {
	batch := make([]string, len(feedIDs))
	copy(batch, feedIDs)
	f.batches = append(f.batches, batch)
}

func (f *fakeRefresher) enqueued() []string {
	flattened := make([]string, 0, len(f.batches))
	for _, batch := range f.batches {
		flattened = append(flattened, batch...)
	}

	return flattened
}

type fakeKindleDispatcher struct {
	running bool
	record  domain.KindleSendRecord
	err     error
	calls   int
}

func (f *fakeKindleDispatcher) IsRunning() bool {
	return f.running
}

func (f *fakeKindleDispatcher) EnqueueManual(ctx context.Context) (domain.KindleSendRecord, error) {
	f.calls++
	if f.err != nil {
		return domain.KindleSendRecord{}, f.err
	}

	return f.record, nil
}

type harness struct {
	t         *testing.T
	handler   http.Handler
	store     *fakeStore
	clock     *testClock
	refresher *fakeRefresher

	kindle         *fakeKindleDispatcher
	feedFetcher    *fakeFeedFetcher
	feedParser     *fakeFeedParser
	webpageFetcher *fakeWebpageFetcher
	extractor      *fakeArticleExtractor

	cookie *http.Cookie
}

func newHarness(t *testing.T) *harness {
	t.Helper()

	return newHarnessWith(t, nil)
}

func newHarnessWith(t *testing.T, configure func(*Config)) *harness {
	t.Helper()

	h := &harness{
		t:              t,
		store:          &fakeStore{},
		clock:          &testClock{current: time.Date(2026, time.March, 1, 8, 0, 0, 0, time.UTC)},
		refresher:      &fakeRefresher{},
		kindle:         &fakeKindleDispatcher{},
		feedFetcher:    &fakeFeedFetcher{},
		feedParser:     &fakeFeedParser{},
		webpageFetcher: &fakeWebpageFetcher{},
		extractor:      &fakeArticleExtractor{},
	}
	h.store.settings = domain.Settings{Retention: 100, Provider: domain.ProviderDirect}

	cfg := Config{
		AppPassword:   testPassword,
		AppURL:        testAppURL,
		SessionSecret: []byte("test-session-secret"),
		Location:      time.UTC,
		Now:           h.clock.Now,

		Folders:     &fakeFolderRepo{store: h.store},
		Feeds:       &fakeFeedRepo{store: h.store},
		FeedItems:   &fakeFeedItemRepo{store: h.store},
		SavedPages:  &fakeSavedPageRepo{store: h.store},
		Settings:    &fakeSettingRepo{store: h.store},
		KindleSends: &fakeKindleSendRepo{store: h.store},

		FeedFetcher:      h.feedFetcher,
		FeedParser:       h.feedParser,
		WebpageFetcher:   h.webpageFetcher,
		ArticleExtractor: h.extractor,

		Refresher: h.refresher,
		Kindle:    h.kindle,
	}

	if configure != nil {
		configure(&cfg)
	}

	handler, err := NewServer(cfg)
	if err != nil {
		t.Fatalf("new server: %v", err)
	}

	h.handler = handler

	return h
}

func (h *harness) do(req *http.Request) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	h.handler.ServeHTTP(recorder, req)

	return recorder
}

func (h *harness) newRequest(method string, target string, body any) *http.Request {
	h.t.Helper()

	var payload io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			h.t.Fatalf("encode request body: %v", err)
		}

		payload = bytes.NewReader(encoded)
	}

	req := httptest.NewRequest(method, target, payload)
	req.Header.Set("Origin", testAppURL)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	return req
}

func (h *harness) rawRequest(method string, target string, body string) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	req.Header.Set("Origin", testAppURL)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(h.sessionCookie())

	return req
}

func (h *harness) raw(method string, target string, body any) *httptest.ResponseRecorder {
	return h.do(h.newRequest(method, target, body))
}

func (h *harness) authed(method string, target string, body any) *httptest.ResponseRecorder {
	req := h.newRequest(method, target, body)
	req.AddCookie(h.sessionCookie())

	return h.do(req)
}

func (h *harness) sessionCookie() *http.Cookie {
	h.t.Helper()

	if h.cookie != nil {
		return h.cookie
	}

	recorder := h.raw(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	if recorder.Code != http.StatusNoContent {
		h.t.Fatalf("login failed: status %d body %s", recorder.Code, recorder.Body.String())
	}

	h.cookie = findCookie(h.t, recorder, sessionCookieName)

	return h.cookie
}

func findCookie(t *testing.T, recorder *httptest.ResponseRecorder, name string) *http.Cookie {
	t.Helper()

	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == name {
			return cookie
		}
	}

	t.Fatalf("response has no %s cookie", name)

	return nil
}

func requireStatus(t *testing.T, recorder *httptest.ResponseRecorder, want int) {
	t.Helper()

	if recorder.Code != want {
		t.Fatalf("status = %d, want %d, body = %s", recorder.Code, want, recorder.Body.String())
	}
}

func requireJSONContentType(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()

	if got := recorder.Header().Get("Content-Type"); got != "application/json; charset=utf-8" {
		t.Fatalf("content type = %q", got)
	}
}

func requireAPIError(t *testing.T, recorder *httptest.ResponseRecorder, wantStatus int, wantCode string) {
	t.Helper()

	requireStatus(t, recorder, wantStatus)
	requireJSONContentType(t, recorder)

	var payload errorResponse
	decodeBody(t, recorder, &payload)

	if payload.Error != wantCode {
		t.Fatalf("error code = %q, want %q", payload.Error, wantCode)
	}
}

func decodeBody(t *testing.T, recorder *httptest.ResponseRecorder, dst any) {
	t.Helper()

	if err := json.Unmarshal(recorder.Body.Bytes(), dst); err != nil {
		t.Fatalf("decode body %q: %v", recorder.Body.String(), err)
	}
}

func TestNewServerValidatesConfig(t *testing.T) {
	t.Parallel()

	if _, err := NewServer(Config{AppURL: testAppURL, SessionSecret: []byte("x")}); err != nil {
		t.Fatalf("expected valid config: %v", err)
	}

	if _, err := NewServer(Config{AppURL: testAppURL}); err == nil {
		t.Fatal("expected error for missing session secret")
	}

	if _, err := NewServer(Config{AppURL: "://bad", SessionSecret: []byte("x")}); err == nil {
		t.Fatal("expected error for invalid app url")
	}

	if _, err := NewServer(Config{AppURL: "/relative", SessionSecret: []byte("x")}); err == nil {
		t.Fatal("expected error for app url without host")
	}
}

func TestHealthz(t *testing.T) {
	t.Parallel()

	healthy := newHarness(t)
	recorder := healthy.raw(http.MethodGet, "/healthz", nil)
	requireStatus(t, recorder, http.StatusOK)
	requireJSONContentType(t, recorder)

	var payload statusResponse
	decodeBody(t, recorder, &payload)
	if payload.Status != "ok" {
		t.Fatalf("status payload = %q", payload.Status)
	}

	unhealthy := newHarnessWith(t, func(cfg *Config) {
		cfg.HealthCheck = func(ctx context.Context) error { return errors.New("database is locked") }
	})
	recorder = unhealthy.raw(http.MethodGet, "/healthz", nil)
	requireStatus(t, recorder, http.StatusServiceUnavailable)

	if strings.Contains(recorder.Body.String(), "database is locked") {
		t.Fatalf("health failure leaked the internal cause: %s", recorder.Body.String())
	}
}

func TestLoginSessionLifecycle(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	recorder := h.raw(http.MethodGet, "/api/auth/session", nil)
	requireStatus(t, recorder, http.StatusOK)

	var session sessionResponse
	decodeBody(t, recorder, &session)
	if session.Authenticated {
		t.Fatal("fresh client must not be authenticated")
	}

	recorder = h.raw(http.MethodPost, "/api/auth/login", map[string]any{"password": "wrong"})
	requireAPIError(t, recorder, http.StatusUnauthorized, "InvalidCredentials")

	recorder = h.raw(http.MethodPost, "/api/auth/login", map[string]any{"password": ""})
	requireAPIError(t, recorder, http.StatusUnauthorized, "InvalidCredentials")

	recorder = h.raw(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	requireStatus(t, recorder, http.StatusNoContent)
	if recorder.Body.Len() != 0 {
		t.Fatalf("login 204 must have an empty body, got %q", recorder.Body.String())
	}

	cookie := findCookie(t, recorder, sessionCookieName)
	if cookie.Value == "" {
		t.Fatal("session cookie value is empty")
	}

	if !cookie.HttpOnly {
		t.Fatal("session cookie must be HttpOnly")
	}

	if !cookie.Secure {
		t.Fatal("session cookie must be Secure for an https APP_URL")
	}

	if cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("session cookie SameSite = %v", cookie.SameSite)
	}

	if cookie.Path != "/" {
		t.Fatalf("session cookie path = %q", cookie.Path)
	}

	if cookie.MaxAge != 30*24*3600 {
		t.Fatalf("session cookie maxAge = %d", cookie.MaxAge)
	}

	if !strings.Contains(cookie.Value, ".") {
		t.Fatalf("session cookie is not signed: %q", cookie.Value)
	}

	recorder = h.authed(http.MethodGet, "/api/auth/session", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &session)
	if !session.Authenticated {
		t.Fatal("expected an authenticated session")
	}

	// A tampered expiry must fail the HMAC check.
	tampered := *cookie
	tampered.Value = "9999999999." + strings.SplitN(cookie.Value, ".", 2)[1]
	req := h.newRequest(http.MethodGet, "/api/auth/session", nil)
	req.AddCookie(&tampered)
	recorder = h.do(req)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &session)
	if session.Authenticated {
		t.Fatal("tampered session cookie must not authenticate")
	}

	// Signatures are verified with hmac.Equal, so a forged signature fails.
	forged := *cookie
	forged.Value = strings.SplitN(cookie.Value, ".", 2)[0] + "." + strings.Repeat("00", 32)
	req = h.newRequest(http.MethodGet, "/api/auth/session", nil)
	req.AddCookie(&forged)
	recorder = h.do(req)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &session)
	if session.Authenticated {
		t.Fatal("forged session signature must not authenticate")
	}

	// The signed expiry must be enforced against the injected clock.
	h.clock.Advance(31 * 24 * time.Hour)
	req = h.newRequest(http.MethodGet, "/api/auth/session", nil)
	req.AddCookie(cookie)
	recorder = h.do(req)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &session)
	if session.Authenticated {
		t.Fatal("expired session cookie must not authenticate")
	}
}

func TestLogoutClearsSessionCookie(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	cookie := h.sessionCookie()

	req := h.newRequest(http.MethodPost, "/api/auth/logout", nil)
	req.AddCookie(cookie)
	recorder := h.do(req)
	requireStatus(t, recorder, http.StatusNoContent)

	cleared := findCookie(t, recorder, sessionCookieName)
	if cleared.Value != "" || cleared.MaxAge >= 0 {
		t.Fatalf("logout cookie = %q maxAge %d", cleared.Value, cleared.MaxAge)
	}
}

func TestLoginRateLimitPerIP(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	limitedIP := "198.51.100.7:41000"

	for attempt := 0; attempt < loginFailureLimit; attempt++ {
		req := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": "wrong"})
		req.RemoteAddr = limitedIP
		requireAPIError(t, h.do(req), http.StatusUnauthorized, "InvalidCredentials")
	}

	req := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	req.RemoteAddr = limitedIP
	requireAPIError(t, h.do(req), http.StatusTooManyRequests, "TooManyRequests")

	otherClient := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	otherClient.RemoteAddr = "198.51.100.8:41000"
	requireStatus(t, h.do(otherClient), http.StatusNoContent)

	h.clock.Advance(loginFailureWindow + time.Second)

	retry := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
	retry.RemoteAddr = limitedIP
	requireStatus(t, h.do(retry), http.StatusNoContent)
}

func TestLoginLimiterReservesAttemptsAtomically(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	limiter := newLoginLimiter(func() time.Time { return now })

	const concurrent = 50

	var (
		wg      sync.WaitGroup
		mu      sync.Mutex
		allowed int
	)

	for range concurrent {
		wg.Add(1)

		go func() {
			defer wg.Done()

			if limiter.reserveAttempt("203.0.113.9") {
				mu.Lock()
				allowed++
				mu.Unlock()
			}
		}()
	}

	wg.Wait()

	if allowed != loginFailureLimit {
		t.Fatalf("allowed attempts = %d, want %d", allowed, loginFailureLimit)
	}
}

func TestLoginLimiterBoundsTrackedIPs(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	limiter := newLoginLimiter(func() time.Time { return now })

	for i := range maxTrackedLoginIPs * 3 {
		if !limiter.reserveAttempt("192.0.2." + strconv.Itoa(i)) {
			t.Fatalf("first attempt for a fresh ip was rejected")
		}
	}

	limiter.mu.Lock()
	tracked := len(limiter.attempts)
	limiter.mu.Unlock()

	if tracked > maxTrackedLoginIPs {
		t.Fatalf("tracked ips = %d, want <= %d", tracked, maxTrackedLoginIPs)
	}
}

func TestCSRFOriginAndReferer(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name            string
		origin          string
		referer         string
		emptyOrigin     bool
		duplicateOrigin bool
		want            int
	}{
		{name: "matching origin", origin: testAppURL, want: http.StatusNoContent},
		{name: "default https port", origin: testAppURL + ":443", want: http.StatusNoContent},
		{name: "referer fallback", referer: testAppURL + "/login?next=%2Flater", want: http.StatusNoContent},
		{name: "missing headers", want: http.StatusForbidden},
		{name: "null origin", origin: "null", want: http.StatusForbidden},
		{name: "scheme mismatch", origin: "http://reader.example.com", want: http.StatusForbidden},
		{name: "host mismatch", origin: "https://evil.example.com", want: http.StatusForbidden},
		{name: "port mismatch", origin: "https://reader.example.com:8443", want: http.StatusForbidden},
		{name: "malformed origin", origin: "https://[::1", want: http.StatusForbidden},
		{name: "origin wins over referer", origin: "https://evil.example.com", referer: testAppURL + "/", want: http.StatusForbidden},
		{name: "origin with path", origin: testAppURL + "/app", want: http.StatusForbidden},
		{name: "origin with query", origin: testAppURL + "?next=%2F", want: http.StatusForbidden},
		{name: "origin with fragment", origin: testAppURL + "#frag", want: http.StatusForbidden},
		{name: "origin with credentials", origin: "https://alice:secret@reader.example.com", want: http.StatusForbidden},
		{name: "duplicate origin headers", duplicateOrigin: true, want: http.StatusForbidden},
		{name: "empty origin does not fall back to referer", emptyOrigin: true, referer: testAppURL + "/login", want: http.StatusForbidden},
		{name: "referer with credentials", referer: "https://alice:secret@reader.example.com/login", want: http.StatusForbidden},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			h := newHarness(t)
			req := h.newRequest(http.MethodPost, "/api/auth/login", map[string]any{"password": testPassword})
			req.Header.Del("Origin")

			switch {
			case testCase.duplicateOrigin:
				req.Header.Add("Origin", testAppURL)
				req.Header.Add("Origin", testAppURL)
			case testCase.emptyOrigin:
				req.Header.Set("Origin", "")
			case testCase.origin != "":
				req.Header.Set("Origin", testCase.origin)
			}

			if testCase.referer != "" {
				req.Header.Set("Referer", testCase.referer)
			}

			recorder := h.do(req)
			requireStatus(t, recorder, testCase.want)

			if testCase.want == http.StatusForbidden {
				requireAPIError(t, recorder, http.StatusForbidden, "Forbidden")
			}
		})
	}
}

func TestCSRFGuardsStateChangingAPIRoutes(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	req := h.newRequest(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://example.com/post"})
	req.Header.Del("Origin")
	requireAPIError(t, h.do(req), http.StatusForbidden, "Forbidden")

	req = h.newRequest(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://example.com/post"})
	req.AddCookie(h.sessionCookie())
	req.Header.Set("Origin", "https://evil.example.com")
	requireAPIError(t, h.do(req), http.StatusForbidden, "Forbidden")

	req = h.newRequest(http.MethodPost, "/api/auth/logout", nil)
	req.Header.Del("Origin")
	requireAPIError(t, h.do(req), http.StatusForbidden, "Forbidden")

	req = h.newRequest(http.MethodPut, "/api/settings/provider", map[string]any{"provider": "jina"})
	req.AddCookie(h.sessionCookie())
	req.Header.Del("Origin")
	requireAPIError(t, h.do(req), http.StatusForbidden, "Forbidden")

	req = h.newRequest(http.MethodPut, "/api/settings/provider", map[string]any{"provider": "jina"})
	req.AddCookie(h.sessionCookie())
	req.Header.Set("Origin", "https://evil.example.com")
	requireAPIError(t, h.do(req), http.StatusForbidden, "Forbidden")

	// GET requests are not CSRF protected; they fail authentication instead.
	req = h.newRequest(http.MethodGet, "/api/saved-pages", nil)
	req.Header.Del("Origin")
	requireAPIError(t, h.do(req), http.StatusUnauthorized, "Unauthorized")
}

func TestMissingSessionRejectsAPIRoutes(t *testing.T) {
	t.Parallel()

	requests := []struct {
		method string
		target string
	}{
		{method: http.MethodGet, target: "/api/saved-pages"},
		{method: http.MethodGet, target: "/api/feeds"},
		{method: http.MethodGet, target: "/api/folders"},
		{method: http.MethodGet, target: "/api/feed-items"},
		{method: http.MethodGet, target: "/api/settings"},
		{method: http.MethodPut, target: "/api/settings/retention"},
		{method: http.MethodPut, target: "/api/settings/provider"},
		{method: http.MethodPut, target: "/api/settings/services/jina"},
		{method: http.MethodDelete, target: "/api/settings/services/jina"},
		{method: http.MethodPut, target: "/api/settings/services/browser"},
		{method: http.MethodDelete, target: "/api/settings/services/browser"},
		{method: http.MethodPut, target: "/api/settings/services/smtp"},
		{method: http.MethodDelete, target: "/api/settings/services/smtp"},
		{method: http.MethodDelete, target: "/api/settings/services/smtp/password"},
		{method: http.MethodPut, target: "/api/settings/kindle"},
		{method: http.MethodGet, target: "/api/opml"},
		{method: http.MethodPost, target: "/api/kindle/send"},
		{method: http.MethodPost, target: "/api/saved-pages/read-all"},
		{method: http.MethodDelete, target: "/api/saved-pages/abc"},
	}

	for _, request := range requests {
		t.Run(request.method+" "+request.target, func(t *testing.T) {
			h := newHarness(t)
			requireAPIError(t, h.raw(request.method, request.target, nil), http.StatusUnauthorized, "Unauthorized")
		})
	}
}

func (h *harness) seedFolder(name string) domain.Folder {
	h.t.Helper()

	folder := domain.Folder{ID: domain.NewID(), Name: name}
	h.store.folders = append(h.store.folders, folder)

	return folder
}

func (h *harness) seedFeed(title string, rawURL string, folderID *string) domain.Feed {
	h.t.Helper()

	normalized, err := domain.ParseNormalizedURL(rawURL, domain.ErrFeedUrlInvalid)
	if err != nil {
		h.t.Fatalf("seed feed url %q: %v", rawURL, err)
	}

	feed := domain.Feed{
		ID:         domain.NewID(),
		URL:        normalized,
		Title:      title,
		FolderID:   folderID,
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
	}
	h.store.feeds = append(h.store.feeds, feed)

	return feed
}

func (h *harness) seedItem(feedID string, rawURL string, configure func(*domain.FeedItem)) domain.FeedItem {
	h.t.Helper()

	normalized, err := domain.ParseNormalizedURL(rawURL, domain.ErrFeedUrlInvalid)
	if err != nil {
		h.t.Fatalf("seed item url %q: %v", rawURL, err)
	}

	item := domain.FeedItem{ID: domain.NewID(), FeedID: feedID, URL: normalized, Title: "Item"}
	if configure != nil {
		configure(&item)
	}

	h.store.items = append(h.store.items, item)

	return item
}

func (h *harness) seedSavedPage(rawURL string, read bool) domain.SavedPage {
	h.t.Helper()

	normalized, err := domain.ParseNormalizedURL(rawURL, domain.ErrInvalidPageUrl)
	if err != nil {
		h.t.Fatalf("seed saved page url %q: %v", rawURL, err)
	}

	page := domain.SavedPage{ID: domain.NewID(), URL: normalized, Title: "Saved", Content: "<p>saved</p>", Read: read}
	h.store.saved = append(h.store.saved, page)

	return page
}

func TestSavedPageCreateAndDuplicate(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	published := time.Date(2024, time.May, 1, 12, 0, 0, 0, time.UTC)
	h.webpageFetcher.html = "<html><body><p>hi</p></body></html>"
	h.webpageFetcher.finalURL = "https://example.com/redirected"
	h.extractor.article = domain.ExtractedArticle{
		Title:       "Hello",
		Description: strPtr("desc"),
		Content:     "<p>hi</p>",
		PublishedAt: &published,
	}

	recorder := h.authed(http.MethodPost, "/api/saved-pages", map[string]any{"url": " https://example.com/post?utm_source=news&id=7 "})
	requireStatus(t, recorder, http.StatusCreated)

	var created itemResponse[savedPageJSON]
	decodeBody(t, recorder, &created)
	if created.Item == nil {
		t.Fatal("created response has no item")
	}

	if created.Item.URL != "https://example.com/post?id=7" {
		t.Fatalf("stored url = %q, want the submitted normalized url", created.Item.URL)
	}

	if created.Item.Title != "Hello" || created.Item.Content != "<p>hi</p>" {
		t.Fatalf("created item = %+v", created.Item)
	}

	if created.Item.Description == nil || *created.Item.Description != "desc" {
		t.Fatalf("created description = %v", created.Item.Description)
	}

	if created.Item.PublishedAt == nil || *created.Item.PublishedAt != "2024-05-01T12:00:00Z" {
		t.Fatalf("created publishedAt = %v", created.Item.PublishedAt)
	}

	if created.Item.Read {
		t.Fatal("a new saved page must be unread")
	}

	if h.webpageFetcher.calls != 1 || h.extractor.calls != 1 {
		t.Fatalf("fetch/extract calls = %d/%d", h.webpageFetcher.calls, h.extractor.calls)
	}

	if h.webpageFetcher.lastURL != "https://example.com/post?id=7" {
		t.Fatalf("fetched url = %q", h.webpageFetcher.lastURL)
	}

	duplicate := h.authed(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://example.com/post?id=7&utm_campaign=again"})
	requireAPIError(t, duplicate, http.StatusConflict, "SavedPageAlreadyExists")

	var conflict errorResponse
	decodeBody(t, duplicate, &conflict)
	if conflict.URL != "https://example.com/post?id=7" {
		t.Fatalf("conflict url = %q", conflict.URL)
	}

	if h.webpageFetcher.calls != 1 {
		t.Fatal("duplicate detection must run before fetching the webpage")
	}
}

func TestSavedPageRedactsURLCredentials(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	h.webpageFetcher.html = "<p>private</p>"
	h.extractor.article = domain.ExtractedArticle{Title: "Private", Content: "<p>private</p>"}

	recorder := h.authed(http.MethodPost, "/api/saved-pages", map[string]any{"url": "https://user:supersecret@example.com/private"})
	requireStatus(t, recorder, http.StatusCreated)

	if strings.Contains(recorder.Body.String(), "supersecret") {
		t.Fatalf("response leaked url credentials: %s", recorder.Body.String())
	}

	var created itemResponse[savedPageJSON]
	decodeBody(t, recorder, &created)
	if created.Item.URL != "https://example.com/private" {
		t.Fatalf("url = %q", created.Item.URL)
	}

	recorder = h.authed(http.MethodGet, "/api/saved-pages", nil)
	requireStatus(t, recorder, http.StatusOK)
	if strings.Contains(recorder.Body.String(), "supersecret") {
		t.Fatalf("list leaked url credentials: %s", recorder.Body.String())
	}
}

func TestSavedPageValidationAndUpstreamFailures(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name       string
		body       map[string]any
		fetchErr   error
		extractErr error
		wantStatus int
		wantCode   string
	}{
		{
			name:       "unsupported scheme",
			body:       map[string]any{"url": "ftp://example.com/file"},
			wantStatus: http.StatusBadRequest,
			wantCode:   "InvalidPageUrl",
		},
		{
			name:       "empty url",
			body:       map[string]any{"url": "   "},
			wantStatus: http.StatusBadRequest,
			wantCode:   "InvalidPageUrl",
		},
		{
			name:       "fetch failure",
			body:       map[string]any{"url": "https://example.com/post"},
			fetchErr:   domain.NewError(domain.ErrWebpageFetcherError, errors.New("dial tcp 10.0.0.1: connect: connection refused")),
			wantStatus: http.StatusUnprocessableEntity,
			wantCode:   "WebpageFetcherError",
		},
		{
			name:       "empty article",
			body:       map[string]any{"url": "https://example.com/post"},
			extractErr: domain.NewError(domain.ErrArticleEmptyContent, nil),
			wantStatus: http.StatusUnprocessableEntity,
			wantCode:   "ArticleEmptyContent",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			h := newHarness(t)
			h.webpageFetcher.err = testCase.fetchErr
			h.extractor.err = testCase.extractErr

			recorder := h.authed(http.MethodPost, "/api/saved-pages", testCase.body)
			requireAPIError(t, recorder, testCase.wantStatus, testCase.wantCode)

			if strings.Contains(recorder.Body.String(), "10.0.0.1") {
				t.Fatalf("error response leaked the internal cause: %s", recorder.Body.String())
			}

			if len(h.store.saved) != 0 {
				t.Fatalf("failed create persisted %d pages", len(h.store.saved))
			}
		})
	}
}

func TestSavedPageLookupAndGet(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	page := h.seedSavedPage("https://example.com/saved", false)

	lookup := h.authed(http.MethodGet, "/api/saved-pages/lookup?url="+url.QueryEscape("https://example.com/saved?utm_medium=x"), nil)
	requireStatus(t, lookup, http.StatusOK)

	var found itemResponse[savedPageJSON]
	decodeBody(t, lookup, &found)
	if found.Item == nil || found.Item.ID != page.ID {
		t.Fatalf("lookup item = %+v", found.Item)
	}

	missing := h.authed(http.MethodGet, "/api/saved-pages/lookup?url="+url.QueryEscape("https://example.com/other"), nil)
	requireStatus(t, missing, http.StatusOK)
	if !strings.Contains(missing.Body.String(), `"item":null`) {
		t.Fatalf("missing lookup body = %s", missing.Body.String())
	}

	invalid := h.authed(http.MethodGet, "/api/saved-pages/lookup?url="+url.QueryEscape("not a url"), nil)
	requireAPIError(t, invalid, http.StatusBadRequest, "InvalidPageUrl")

	noParam := h.authed(http.MethodGet, "/api/saved-pages/lookup", nil)
	requireAPIError(t, noParam, http.StatusBadRequest, "InvalidPageUrl")

	byID := h.authed(http.MethodGet, "/api/saved-pages/"+page.ID, nil)
	requireStatus(t, byID, http.StatusOK)

	var fetched itemResponse[savedPageJSON]
	decodeBody(t, byID, &fetched)
	if fetched.Item == nil || fetched.Item.ID != page.ID {
		t.Fatalf("get item = %+v", fetched.Item)
	}

	unknown := h.authed(http.MethodGet, "/api/saved-pages/"+domain.NewID(), nil)
	requireStatus(t, unknown, http.StatusOK)
	decodeBody(t, unknown, &fetched)
	if fetched.Item != nil {
		t.Fatalf("unknown id returned %+v", fetched.Item)
	}
}

func TestSavedPagePagingAndReadState(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	first := h.seedSavedPage("https://example.com/1", false)
	second := h.seedSavedPage("https://example.com/2", false)
	third := h.seedSavedPage("https://example.com/3", false)

	recorder := h.authed(http.MethodGet, "/api/saved-pages?limit=2", nil)
	requireStatus(t, recorder, http.StatusOK)

	var page pageResponse[savedPageJSON]
	decodeBody(t, recorder, &page)
	if len(page.Items) != 2 || page.Items[0].ID != third.ID || page.Items[1].ID != second.ID {
		t.Fatalf("first page = %+v", page.Items)
	}

	if page.Cursor == nil || *page.Cursor != second.ID {
		t.Fatalf("first page cursor = %v", page.Cursor)
	}

	recorder = h.authed(http.MethodGet, "/api/saved-pages?limit=2&cursor="+*page.Cursor, nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 1 || page.Items[0].ID != first.ID {
		t.Fatalf("second page = %+v", page.Items)
	}

	if page.Cursor != nil {
		t.Fatalf("last page cursor must be null, got %q", *page.Cursor)
	}

	h.store.SetSavedPageRead(second.ID, true)

	recorder = h.authed(http.MethodGet, "/api/saved-pages?unread", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 2 {
		t.Fatalf("unread filter returned %d items", len(page.Items))
	}

	recorder = h.authed(http.MethodGet, "/api/saved-pages?unread=false", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 3 {
		t.Fatalf("unread=false returned %d items", len(page.Items))
	}

	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages?unread=maybe", nil), http.StatusBadRequest, "RequestFailed")
	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages?limit=0", nil), http.StatusBadRequest, "RequestFailed")
	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages?limit=201", nil), http.StatusBadRequest, "RequestFailed")
	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages?cursor=not-a-uuid", nil), http.StatusBadRequest, "RequestFailed")

	recorder = h.authed(http.MethodGet, "/api/saved-pages/unread-count", nil)
	requireStatus(t, recorder, http.StatusOK)

	var count countResponse
	decodeBody(t, recorder, &count)
	if count.Count != 2 {
		t.Fatalf("unread count = %d", count.Count)
	}

	requireStatus(t, h.authed(http.MethodPatch, "/api/saved-pages/"+third.ID, map[string]any{"read": true}), http.StatusNoContent)
	if !h.store.savedByID(third.ID).Read {
		t.Fatal("PATCH read did not persist")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/saved-pages/read", map[string]any{"ids": []string{first.ID}}), http.StatusNoContent)
	if !h.store.savedByID(first.ID).Read {
		t.Fatal("POST read did not persist")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/saved-pages/read-all", nil), http.StatusNoContent)
	for _, saved := range h.store.saved {
		if !saved.Read {
			t.Fatalf("page %s still unread after read-all", saved.ID)
		}
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/saved-pages/"+second.ID, nil), http.StatusNoContent)

	recorder = h.authed(http.MethodGet, "/api/saved-pages/"+second.ID, nil)
	requireStatus(t, recorder, http.StatusOK)

	var single itemResponse[savedPageJSON]
	decodeBody(t, recorder, &single)
	if single.Item != nil {
		t.Fatal("deleted page is still returned")
	}
}

func TestSavedPageRepositoryErrorsAreSanitized(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	h.store.savedPagesErr = domain.NewError(domain.ErrSavedPageRepositoryError, errors.New("sqlite: disk I/O error at /data/reader.db"))

	recorder := h.authed(http.MethodGet, "/api/saved-pages", nil)
	requireAPIError(t, recorder, http.StatusInternalServerError, "SavedPageRepositoryError")

	if strings.Contains(recorder.Body.String(), "disk I/O error") {
		t.Fatalf("response leaked the internal cause: %s", recorder.Body.String())
	}

	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages/unread-count", nil), http.StatusInternalServerError, "SavedPageRepositoryError")
}

func TestFeedItemSave(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Feed", "https://feeds.example.com/rss", nil)
	extracted := h.seedItem(feed.ID, "https://example.com/extracted", func(item *domain.FeedItem) {
		item.Title = "Extracted"
		item.Description = strPtr("feed description")
		item.ExtractedContent = strPtr("<p>extracted</p>")
	})
	withContent := h.seedItem(feed.ID, "https://example.com/content", func(item *domain.FeedItem) {
		item.Content = strPtr("<p>content</p>")
	})
	bare := h.seedItem(feed.ID, "https://example.com/bare", func(item *domain.FeedItem) {
		item.Title = "Bare"
	})
	h.webpageFetcher.html = "<html></html>"
	h.extractor.article = domain.ExtractedArticle{Title: "Fetched", Content: "<p>fetched</p>"}

	recorder := h.authed(http.MethodPost, "/api/feed-items/"+extracted.ID+"/save", nil)
	requireStatus(t, recorder, http.StatusCreated)

	var created itemResponse[savedPageJSON]
	decodeBody(t, recorder, &created)
	if created.Item == nil || created.Item.Content != "<p>extracted</p>" {
		t.Fatalf("extracted content was not reused: %+v", created.Item)
	}

	if created.Item.Description == nil || *created.Item.Description != "feed description" {
		t.Fatalf("description = %v", created.Item.Description)
	}

	if created.Item.Read {
		t.Fatal("saved copies must start unread")
	}

	if h.webpageFetcher.calls != 0 {
		t.Fatal("saving an item with extracted content must not fetch the webpage")
	}

	duplicate := h.authed(http.MethodPost, "/api/feed-items/"+extracted.ID+"/save", nil)
	requireAPIError(t, duplicate, http.StatusConflict, "SavedPageAlreadyExists")

	var conflict errorResponse
	decodeBody(t, duplicate, &conflict)
	if conflict.URL != "https://example.com/extracted" {
		t.Fatalf("conflict url = %q", conflict.URL)
	}

	recorder = h.authed(http.MethodPost, "/api/feed-items/"+withContent.ID+"/save", nil)
	requireStatus(t, recorder, http.StatusCreated)
	decodeBody(t, recorder, &created)
	if created.Item.Content != "<p>content</p>" {
		t.Fatalf("feed content was not reused: %+v", created.Item)
	}

	if h.webpageFetcher.calls != 0 {
		t.Fatal("saving an item with feed content must not fetch the webpage")
	}

	recorder = h.authed(http.MethodPost, "/api/feed-items/"+bare.ID+"/save", nil)
	requireStatus(t, recorder, http.StatusCreated)
	decodeBody(t, recorder, &created)
	if created.Item.Content != "<p>fetched</p>" || created.Item.Title != "Fetched" {
		t.Fatalf("fetched save = %+v", created.Item)
	}

	if h.webpageFetcher.calls != 1 {
		t.Fatalf("expected one webpage fetch, got %d", h.webpageFetcher.calls)
	}

	missing := h.authed(http.MethodPost, "/api/feed-items/"+domain.NewID()+"/save", nil)
	requireAPIError(t, missing, http.StatusNotFound, "FeedItemNotFound")
}

func TestFeedPreview(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	h.feedFetcher.body = []byte("<rss></rss>")
	h.feedFetcher.finalURL = "https://feeds.example.com/final"
	h.feedParser.parsed = domain.ParsedFeed{
		Title:       "   ",
		Description: strPtr("feed description"),
		Entries: []domain.ParsedFeedEntry{
			{Title: "one"},
			{Title: "two"},
			{Title: "three"},
			{Title: "four"},
		},
	}

	recorder := h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "https://feeds.example.com/rss?utm_source=x"})
	requireStatus(t, recorder, http.StatusOK)

	var preview feedPreviewResponse
	decodeBody(t, recorder, &preview)

	if preview.Preview.URL != "https://feeds.example.com/rss" {
		t.Fatalf("preview url = %q", preview.Preview.URL)
	}

	if preview.Preview.Title != "feeds.example.com" {
		t.Fatalf("preview title = %q", preview.Preview.Title)
	}

	if joined := strings.Join(preview.Preview.Titles, ","); joined != "one,two,three" {
		t.Fatalf("preview titles = %q", joined)
	}

	if preview.Preview.Description == nil || *preview.Preview.Description != "feed description" {
		t.Fatalf("preview description = %v", preview.Preview.Description)
	}

	h.feedParser.parsed = domain.ParsedFeed{Title: "Go Blog", Entries: nil}
	recorder = h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "https://feeds.example.com/rss"})
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &preview)

	if preview.Preview.Title != "Go Blog" {
		t.Fatalf("preview title = %q", preview.Preview.Title)
	}

	if preview.Preview.Titles == nil || len(preview.Preview.Titles) != 0 {
		t.Fatalf("empty titles must serialize as [], got %+v", preview.Preview.Titles)
	}

	if !strings.Contains(recorder.Body.String(), `"titles":[]`) {
		t.Fatalf("empty titles JSON = %s", recorder.Body.String())
	}

	requireAPIError(t, h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "javascript:alert(1)"}), http.StatusBadRequest, "FeedUrlInvalid")

	h.feedFetcher.err = domain.NewError(domain.ErrFetchFeedError, errors.New("boom"))
	requireAPIError(t, h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "https://feeds.example.com/rss"}), http.StatusUnprocessableEntity, "FetchFeedError")

	h.feedFetcher.err = nil
	h.feedParser.err = domain.NewError(domain.ErrFeedParserError, errors.New("bad xml"))
	requireAPIError(t, h.authed(http.MethodPost, "/api/feeds/preview", map[string]any{"url": "https://feeds.example.com/rss"}), http.StatusUnprocessableEntity, "FeedParserError")
}

func TestFeedSubscribe(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")

	recorder := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://feeds.example.com/rss", "folderId": folder.ID})
	requireStatus(t, recorder, http.StatusCreated)

	var created itemResponse[feedJSON]
	decodeBody(t, recorder, &created)
	if created.Item == nil {
		t.Fatal("subscribe response has no item")
	}

	if created.Item.Title != "feeds.example.com" {
		t.Fatalf("default title = %q", created.Item.Title)
	}

	if created.Item.ReaderMode != domain.ReaderModeDefault || created.Item.Order != domain.SortOrderNewest {
		t.Fatalf("defaults = %s/%s", created.Item.ReaderMode, created.Item.Order)
	}

	if created.Item.FolderID == nil || *created.Item.FolderID != folder.ID {
		t.Fatalf("folderId = %v", created.Item.FolderID)
	}

	if enqueued := h.refresher.enqueued(); len(enqueued) != 1 || enqueued[0] != created.Item.ID {
		t.Fatalf("refresh enqueue = %+v", h.refresher.batches)
	}

	recorder = h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://second.example.com/rss", "title": "  Go Blog  "})
	requireStatus(t, recorder, http.StatusCreated)
	decodeBody(t, recorder, &created)
	if created.Item.Title != "Go Blog" {
		t.Fatalf("explicit title = %q", created.Item.Title)
	}

	duplicate := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://feeds.example.com/rss?utm_source=x"})
	requireAPIError(t, duplicate, http.StatusConflict, "FeedAlreadyExists")

	var conflict errorResponse
	decodeBody(t, duplicate, &conflict)
	if conflict.URL != "https://feeds.example.com/rss" {
		t.Fatalf("conflict url = %q", conflict.URL)
	}

	missingFolder := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": "https://third.example.com/rss", "folderId": domain.NewID()})
	requireAPIError(t, missingFolder, http.StatusNotFound, "FolderNotFound")

	invalidURL := h.authed(http.MethodPost, "/api/feeds", map[string]any{"url": ""})
	requireAPIError(t, invalidURL, http.StatusBadRequest, "FeedUrlInvalid")
}

func TestFeedPreferencesAndDelete(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)

	requireStatus(t, h.authed(http.MethodPut, "/api/feeds/"+feed.ID+"/reader-mode", map[string]any{"readerMode": "extracted"}), http.StatusNoContent)
	if got := h.store.feedByID(feed.ID).ReaderMode; got != domain.ReaderModeExtracted {
		t.Fatalf("reader mode = %q", got)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/feeds/"+feed.ID+"/reader-mode", map[string]any{"readerMode": "bogus"}), http.StatusBadRequest, "RequestFailed")

	requireStatus(t, h.authed(http.MethodPut, "/api/feeds/"+feed.ID+"/order", map[string]any{"order": "oldest"}), http.StatusNoContent)
	if got := h.store.feedByID(feed.ID).Order; got != domain.SortOrderOldest {
		t.Fatalf("order = %q", got)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/feeds/"+feed.ID+"/order", map[string]any{"order": "bogus"}), http.StatusBadRequest, "RequestFailed")

	requireStatus(t, h.authed(http.MethodPatch, "/api/feeds/"+feed.ID, map[string]any{"folderId": folder.ID}), http.StatusNoContent)
	if got := h.store.feedByID(feed.ID).FolderID; got == nil || *got != folder.ID {
		t.Fatalf("move to folder = %v", got)
	}

	requireStatus(t, h.authed(http.MethodPatch, "/api/feeds/"+feed.ID, map[string]any{"folderId": nil}), http.StatusNoContent)
	if got := h.store.feedByID(feed.ID).FolderID; got != nil {
		t.Fatalf("move to top level = %v", got)
	}

	requireAPIError(t, h.authed(http.MethodPatch, "/api/feeds/"+feed.ID, map[string]any{"folderId": domain.NewID()}), http.StatusNotFound, "FolderNotFound")

	requireStatus(t, h.authed(http.MethodPost, "/api/feeds/"+feed.ID+"/refresh", nil), http.StatusAccepted)
	if batches := h.refresher.batches; len(batches) != 1 || len(batches[0]) != 1 || batches[0][0] != feed.ID {
		t.Fatalf("refresh enqueue = %+v", batches)
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/feeds/"+feed.ID, nil), http.StatusNoContent)
	if h.store.feedByID(feed.ID) != nil {
		t.Fatal("feed was not deleted")
	}
}

func TestFeedMoveRequiresFolderIDKey(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", &folder.ID)

	// An empty object is a malformed move request, not a move to the top level.
	requireAPIError(t, h.authed(http.MethodPatch, "/api/feeds/"+feed.ID, map[string]any{}), http.StatusBadRequest, "RequestFailed")

	if got := h.store.feedByID(feed.ID).FolderID; got == nil || *got != folder.ID {
		t.Fatalf("feed folder changed by malformed request: %v", got)
	}

	requireAPIError(t, h.authed(http.MethodPatch, "/api/feeds/"+feed.ID, map[string]any{"folderId": 42}), http.StatusBadRequest, "RequestFailed")

	requireStatus(t, h.authed(http.MethodPatch, "/api/feeds/"+feed.ID, map[string]any{"folderId": nil}), http.StatusNoContent)
	if got := h.store.feedByID(feed.ID).FolderID; got != nil {
		t.Fatalf("explicit null did not move the feed to the top level: %v", got)
	}

	requireStatus(t, h.authed(http.MethodPatch, "/api/feeds/"+feed.ID, map[string]any{"folderId": folder.ID}), http.StatusNoContent)
	if got := h.store.feedByID(feed.ID).FolderID; got == nil || *got != folder.ID {
		t.Fatalf("folder id did not move the feed: %v", got)
	}
}

func TestReadStateRequiresExplicitFlag(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	page := h.seedSavedPage("https://example.com/page", false)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	item := h.seedItem(feed.ID, "https://feeds.example.com/one", nil)

	requireAPIError(t, h.authed(http.MethodPatch, "/api/saved-pages/"+page.ID, map[string]any{}), http.StatusBadRequest, "RequestFailed")
	if h.store.savedByID(page.ID).Read {
		t.Fatal("malformed request changed the saved page read state")
	}

	requireStatus(t, h.authed(http.MethodPatch, "/api/saved-pages/"+page.ID, map[string]any{"read": true}), http.StatusNoContent)
	if !h.store.savedByID(page.ID).Read {
		t.Fatal("explicit read flag was not applied")
	}

	requireAPIError(t, h.authed(http.MethodPatch, "/api/feed-items/"+item.ID, map[string]any{}), http.StatusBadRequest, "RequestFailed")

	requireStatus(t, h.authed(http.MethodPatch, "/api/feed-items/"+item.ID, map[string]any{"read": false}), http.StatusNoContent)
}

func TestHTTPJSONRejectsTrailingTokens(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	recorder := h.do(h.rawRequest(http.MethodPost, "/api/feeds/preview", `{"url":"https://feeds.example.com/rss"}{"url":"https://evil.example.com/rss"}`))
	requireAPIError(t, recorder, http.StatusBadRequest, "RequestFailed")

	recorder = h.do(h.rawRequest(http.MethodPost, "/api/saved-pages/read", `{"ids":[]} trailing`))
	requireAPIError(t, recorder, http.StatusBadRequest, "RequestFailed")

	recorder = h.do(h.rawRequest(http.MethodPost, "/api/feeds/preview", `{"url":"https://feeds.example.com/rss"}`+"\n"))
	requireStatus(t, recorder, http.StatusOK)
}

func TestFeedItemOrdering(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	oldestFeed := h.seedFeed("Oldest", "https://feeds.example.com/oldest", nil)
	h.store.feeds[h.store.feedIndex(oldestFeed.ID)].Order = domain.SortOrderOldest
	newestFeed := h.seedFeed("Newest", "https://feeds.example.com/newest", nil)

	first := h.seedItem(oldestFeed.ID, "https://example.com/first", nil)
	second := h.seedItem(oldestFeed.ID, "https://example.com/second", nil)
	other := h.seedItem(newestFeed.ID, "https://example.com/other", nil)

	recorder := h.authed(http.MethodGet, "/api/feeds/"+oldestFeed.ID+"/items", nil)
	requireStatus(t, recorder, http.StatusOK)

	var page pageResponse[feedItemJSON]
	decodeBody(t, recorder, &page)
	if len(page.Items) != 2 || page.Items[0].ID != first.ID || page.Items[1].ID != second.ID {
		t.Fatalf("stored oldest order ignored: %+v", page.Items)
	}

	recorder = h.authed(http.MethodGet, "/api/feeds/"+oldestFeed.ID+"/items?order=newest", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if page.Items[0].ID != second.ID || page.Items[1].ID != first.ID {
		t.Fatalf("explicit newest order ignored: %+v", page.Items)
	}

	requireAPIError(t, h.authed(http.MethodGet, "/api/feeds/"+oldestFeed.ID+"/items?order=bogus", nil), http.StatusBadRequest, "RequestFailed")

	recorder = h.authed(http.MethodGet, "/api/feed-items", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 3 || page.Items[0].ID != other.ID {
		t.Fatalf("all items must be newest first: %+v", page.Items)
	}

	recorder = h.authed(http.MethodGet, "/api/feeds/"+oldestFeed.ID+"/items?limit=1", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 1 || page.Cursor == nil || *page.Cursor != first.ID {
		t.Fatalf("paged feed items = %+v cursor %v", page.Items, page.Cursor)
	}

	recorder = h.authed(http.MethodGet, "/api/feeds/"+domain.NewID()+"/items", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if page.Items == nil || len(page.Items) != 0 || page.Cursor != nil {
		t.Fatalf("unknown feed page = %+v", page)
	}

	if !strings.Contains(recorder.Body.String(), `"items":[]`) {
		t.Fatalf("empty page items must serialize as []: %s", recorder.Body.String())
	}
}

func TestFeedItemReadStateAndCounts(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	first := h.seedItem(feed.ID, "https://example.com/1", nil)
	second := h.seedItem(feed.ID, "https://example.com/2", nil)

	recorder := h.authed(http.MethodGet, "/api/feed-items/"+first.ID, nil)
	requireStatus(t, recorder, http.StatusOK)

	var single itemResponse[feedItemJSON]
	decodeBody(t, recorder, &single)
	if single.Item == nil || single.Item.ID != first.ID || single.Item.FeedID != feed.ID {
		t.Fatalf("item = %+v", single.Item)
	}

	recorder = h.authed(http.MethodGet, "/api/feed-items/"+domain.NewID(), nil)
	requireStatus(t, recorder, http.StatusOK)
	if !strings.Contains(recorder.Body.String(), `"item":null`) {
		t.Fatalf("unknown item body = %s", recorder.Body.String())
	}

	recorder = h.authed(http.MethodGet, "/api/feeds/unread-counts", nil)
	requireStatus(t, recorder, http.StatusOK)

	var counts listResponse[feedUnreadCountJSON]
	decodeBody(t, recorder, &counts)
	if len(counts.Items) != 1 || counts.Items[0].FeedID != feed.ID || counts.Items[0].Count != 2 {
		t.Fatalf("unread counts = %+v", counts.Items)
	}

	requireStatus(t, h.authed(http.MethodPatch, "/api/feed-items/"+first.ID, map[string]any{"read": true}), http.StatusNoContent)
	if !h.store.feedItemByID(first.ID).Read {
		t.Fatal("PATCH read did not persist")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/feed-items/read", map[string]any{"ids": []string{second.ID}}), http.StatusNoContent)
	if !h.store.feedItemByID(second.ID).Read {
		t.Fatal("POST read did not persist")
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/feeds/"+feed.ID+"/read-all", nil), http.StatusNoContent)

	third := h.seedItem(feed.ID, "https://example.com/3", nil)
	requireStatus(t, h.authed(http.MethodPost, "/api/feed-items/read-all", nil), http.StatusNoContent)
	if !h.store.feedItemByID(third.ID).Read {
		t.Fatal("read-all did not mark items read")
	}
}

func TestFeedItemExtract(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", nil)
	cached := h.seedItem(feed.ID, "https://example.com/cached", func(item *domain.FeedItem) {
		item.ExtractedContent = strPtr("<p>cached</p>")
	})
	bare := h.seedItem(feed.ID, "https://example.com/bare", nil)
	h.webpageFetcher.html = "<html></html>"
	h.extractor.article = domain.ExtractedArticle{Title: "Extracted", Content: "<p>extracted</p>"}

	recorder := h.authed(http.MethodPost, "/api/feed-items/"+cached.ID+"/extract", nil)
	requireStatus(t, recorder, http.StatusOK)

	var extracted itemResponse[feedItemJSON]
	decodeBody(t, recorder, &extracted)
	if extracted.Item == nil || extracted.Item.ExtractedContent == nil || *extracted.Item.ExtractedContent != "<p>cached</p>" {
		t.Fatalf("cached item = %+v", extracted.Item)
	}

	if h.webpageFetcher.calls != 0 {
		t.Fatal("cached extraction must not fetch the webpage")
	}

	recorder = h.authed(http.MethodPost, "/api/feed-items/"+bare.ID+"/extract", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &extracted)
	if extracted.Item.ExtractedContent == nil || *extracted.Item.ExtractedContent != "<p>extracted</p>" {
		t.Fatalf("extracted item = %+v", extracted.Item)
	}

	if h.webpageFetcher.calls != 1 {
		t.Fatalf("webpage fetch calls = %d", h.webpageFetcher.calls)
	}

	stored := h.store.feedItemByID(bare.ID)
	if stored.ExtractedContent == nil || *stored.ExtractedContent != "<p>extracted</p>" {
		t.Fatal("extracted content was not stored")
	}

	requireAPIError(t, h.authed(http.MethodPost, "/api/feed-items/"+domain.NewID()+"/extract", nil), http.StatusNotFound, "FeedItemNotFound")

	h.extractor.err = domain.NewError(domain.ErrArticleExtractorError, errors.New("readability failed"))
	failing := h.seedItem(feed.ID, "https://example.com/failing", nil)
	requireAPIError(t, h.authed(http.MethodPost, "/api/feed-items/"+failing.ID+"/extract", nil), http.StatusUnprocessableEntity, "ArticleExtractorError")
}

func TestFolderCRUD(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	recorder := h.authed(http.MethodPost, "/api/folders", map[string]any{"name": "  Tech  "})
	requireStatus(t, recorder, http.StatusCreated)

	var created itemResponse[folderJSON]
	decodeBody(t, recorder, &created)
	if created.Item == nil || created.Item.Name != "Tech" {
		t.Fatalf("created folder = %+v", created.Item)
	}

	requireAPIError(t, h.authed(http.MethodPost, "/api/folders", map[string]any{"name": "   "}), http.StatusBadRequest, "InvalidFolderName")
	requireAPIError(t, h.authed(http.MethodPost, "/api/folders", map[string]any{"name": "Tech"}), http.StatusConflict, "FolderAlreadyExists")

	requireStatus(t, h.authed(http.MethodPatch, "/api/folders/"+created.Item.ID, map[string]any{"name": "Technology"}), http.StatusNoContent)
	if got := h.store.folderByID(created.Item.ID).Name; got != "Technology" {
		t.Fatalf("renamed folder = %q", got)
	}

	requireAPIError(t, h.authed(http.MethodPatch, "/api/folders/"+domain.NewID(), map[string]any{"name": "Nope"}), http.StatusNotFound, "FolderNotFound")

	other := h.seedFolder("Life")
	requireAPIError(t, h.authed(http.MethodPatch, "/api/folders/"+created.Item.ID, map[string]any{"name": other.Name}), http.StatusConflict, "FolderAlreadyExists")

	recorder = h.authed(http.MethodGet, "/api/folders", nil)
	requireStatus(t, recorder, http.StatusOK)

	var listed listResponse[folderJSON]
	decodeBody(t, recorder, &listed)
	if len(listed.Items) != 2 || listed.Items[0].Name != "Life" || listed.Items[1].Name != "Technology" {
		t.Fatalf("folder list = %+v", listed.Items)
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/folders/"+created.Item.ID, nil), http.StatusNoContent)
	if h.store.folderByID(created.Item.ID) != nil {
		t.Fatal("folder was not deleted")
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/folders/"+domain.NewID(), nil), http.StatusNoContent)
}

func TestFolderDeleteMovesFeedsToTopLevel(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", &folder.ID)

	requireStatus(t, h.authed(http.MethodDelete, "/api/folders/"+folder.ID, nil), http.StatusNoContent)

	moved := h.store.feedByID(feed.ID)
	if moved == nil {
		t.Fatal("deleting a folder must not delete its feeds")
	}

	if moved.FolderID != nil {
		t.Fatalf("feed folder after delete = %v", moved.FolderID)
	}

	recorder := h.authed(http.MethodGet, "/api/feeds", nil)
	requireStatus(t, recorder, http.StatusOK)

	var listed listResponse[feedJSON]
	decodeBody(t, recorder, &listed)
	if len(listed.Items) != 1 {
		t.Fatalf("feeds = %+v", listed.Items)
	}

	if listed.Items[0].FolderID != nil {
		t.Fatalf("top-level feed serialized folderId = %v", *listed.Items[0].FolderID)
	}

	if strings.Contains(recorder.Body.String(), `"folderId"`) {
		t.Fatalf("absent folderId must be omitted: %s", recorder.Body.String())
	}
}

func TestFolderItemsAndReadAll(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	inFolder := h.seedFeed("Go Blog", "https://feeds.example.com/rss", &folder.ID)
	outside := h.seedFeed("Other", "https://other.example.com/rss", nil)
	read := h.seedItem(inFolder.ID, "https://example.com/read", func(item *domain.FeedItem) { item.Read = true })
	unread := h.seedItem(inFolder.ID, "https://example.com/unread", nil)
	h.seedItem(outside.ID, "https://example.com/outside", nil)

	recorder := h.authed(http.MethodGet, "/api/folders/"+folder.ID+"/items?unread", nil)
	requireStatus(t, recorder, http.StatusOK)

	var page pageResponse[feedItemJSON]
	decodeBody(t, recorder, &page)
	if len(page.Items) != 1 || page.Items[0].ID != unread.ID {
		t.Fatalf("folder unread items = %+v", page.Items)
	}

	requireStatus(t, h.authed(http.MethodPost, "/api/folders/"+folder.ID+"/read-all", nil), http.StatusNoContent)
	if !h.store.feedItemByID(unread.ID).Read || !h.store.feedItemByID(read.ID).Read {
		t.Fatal("folder read-all did not mark items read")
	}

	recorder = h.authed(http.MethodGet, "/api/folders/"+domain.NewID()+"/items", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &page)
	if len(page.Items) != 0 {
		t.Fatalf("unknown folder items = %+v", page.Items)
	}
}

func TestOPMLExport(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	h.seedFeed("Top Feed", "https://top.example.com/rss", nil)
	h.seedFeed("Private", "https://user:supersecret@private.example.com/rss", &folder.ID)

	recorder := h.authed(http.MethodGet, "/api/opml", nil)
	requireStatus(t, recorder, http.StatusOK)

	if contentType := recorder.Header().Get("Content-Type"); contentType != "text/x-opml+xml; charset=utf-8" {
		t.Fatalf("content type = %q", contentType)
	}

	if disposition := recorder.Header().Get("Content-Disposition"); !strings.Contains(disposition, `filename="subscriptions.opml"`) {
		t.Fatalf("content disposition = %q", disposition)
	}

	body := recorder.Body.String()
	wanted := []string{
		`<outline text="Tech"`,
		`xmlUrl="https://private.example.com/rss"`,
		`xmlUrl="https://top.example.com/rss"`,
		`version="2.0"`,
	}
	for _, want := range wanted {
		if !strings.Contains(body, want) {
			t.Fatalf("opml export is missing %q:\n%s", want, body)
		}
	}

	if strings.Contains(body, "supersecret") {
		t.Fatalf("opml export leaked url credentials:\n%s", body)
	}
}

func TestOPMLExportKeepsFeedsWithMissingFolder(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Gone")
	orphan := h.seedFeed("Orphan", "https://orphan.example.com/rss", &folder.ID)

	// Simulate a concurrent folder deletion between the folder and feed reads.
	h.store.folders = nil

	recorder := h.authed(http.MethodGet, "/api/opml", nil)
	requireStatus(t, recorder, http.StatusOK)

	body := recorder.Body.String()
	if !strings.Contains(body, `xmlUrl="https://orphan.example.com/rss"`) {
		t.Fatalf("opml export dropped a feed whose folder vanished:\n%s", body)
	}

	if got := h.store.feedByID(orphan.ID); got == nil {
		t.Fatal("export must not mutate feeds")
	}
}

func TestOPMLImportRawXML(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	h.seedFeed("Go Blog", "https://go.example.com/rss", nil)

	document := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <body>
    <outline text="Tech">
      <outline type="rss" text="Go Blog" xmlUrl="https://go.example.com/rss"/>
      <outline type="rss" text="Rust Blog" xmlUrl="https://rust.example.com/rss?utm_source=opml"/>
    </outline>
  </body>
</opml>`

	req := httptest.NewRequest(http.MethodPost, "/api/opml", strings.NewReader(document))
	req.Header.Set("Content-Type", "text/x-opml+xml")
	req.Header.Set("Origin", testAppURL)
	req.AddCookie(h.sessionCookie())

	recorder := h.do(req)
	requireStatus(t, recorder, http.StatusOK)

	var result opmlImportResponse
	decodeBody(t, recorder, &result)
	if result.ImportedFeeds != 1 || result.SkippedFeeds != 1 || result.CreatedFolders != 1 {
		t.Fatalf("import result = %+v", result)
	}

	enqueued := h.refresher.enqueued()
	if len(enqueued) != 1 {
		t.Fatalf("refresher batches = %+v", h.refresher.batches)
	}

	var imported *domain.Feed
	for i := range h.store.feeds {
		if h.store.feeds[i].URL.RedactedString() == "https://rust.example.com/rss" {
			imported = &h.store.feeds[i]
		}
	}

	if imported == nil {
		t.Fatalf("imported feed missing: %+v", h.store.feeds)
	}

	if enqueued[0] != imported.ID {
		t.Fatalf("enqueued %q, want new feed %q", enqueued[0], imported.ID)
	}

	var tech *domain.Folder
	for i := range h.store.folders {
		if h.store.folders[i].Name == "Tech" {
			tech = &h.store.folders[i]
		}
	}

	if tech == nil {
		t.Fatal("folder Tech was not created")
	}

	if imported.FolderID == nil || *imported.FolderID != tech.ID {
		t.Fatalf("imported folder = %v", imported.FolderID)
	}

	for _, feed := range h.store.feeds {
		if feed.URL.RedactedString() == "https://go.example.com/rss" && feed.FolderID != nil {
			t.Fatal("a skipped duplicate must not be moved into the imported folder")
		}
	}
}

func TestOPMLImportMultipart(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	document := `<opml version="2.0"><body><outline text="News"><outline type="rss" text="A" xmlUrl="https://a.example.com/rss"/><outline type="rss" text="B" xmlUrl="https://b.example.com/rss"/></outline></body></opml>`

	var payload bytes.Buffer
	writer := multipart.NewWriter(&payload)
	part, err := writer.CreateFormFile("file", "subscriptions.opml")
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}

	if _, err := part.Write([]byte(document)); err != nil {
		t.Fatalf("write form file: %v", err)
	}

	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/opml", bytes.NewReader(payload.Bytes()))
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Origin", testAppURL)
	req.AddCookie(h.sessionCookie())

	recorder := h.do(req)
	requireStatus(t, recorder, http.StatusOK)

	var result opmlImportResponse
	decodeBody(t, recorder, &result)
	if result.ImportedFeeds != 2 || result.SkippedFeeds != 0 || result.CreatedFolders != 1 {
		t.Fatalf("import result = %+v", result)
	}

	if enqueued := h.refresher.enqueued(); len(enqueued) != 2 {
		t.Fatalf("enqueued = %+v", h.refresher.batches)
	}
}

func TestOPMLImportRejectsInvalidDocument(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	req := httptest.NewRequest(http.MethodPost, "/api/opml", strings.NewReader("<rss><channel/></rss>"))
	req.Header.Set("Content-Type", "text/xml")
	req.Header.Set("Origin", testAppURL)
	req.AddCookie(h.sessionCookie())

	recorder := h.do(req)
	requireAPIError(t, recorder, http.StatusBadRequest, "InvalidOpml")

	if len(h.store.feeds) != 0 || len(h.store.folders) != 0 {
		t.Fatal("invalid OPML must not write anything")
	}

	if len(h.refresher.batches) != 0 {
		t.Fatalf("invalid OPML must not enqueue refreshes: %+v", h.refresher.batches)
	}
}

func TestSettingsRedaction(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	jinaKey := "jina-super-secret"
	browserEndpoint := "http://browser.internal:9222"
	smtpPassword := "smtp-super-secret"
	smtpUser := "smtp-user"
	sendTime := "08:00"
	nextSendAt := time.Date(2026, time.March, 1, 8, 30, 0, 0, time.UTC)
	h.store.settings = domain.Settings{
		Retention:       42,
		Provider:        domain.ProviderBrowser,
		JinaKey:         &jinaKey,
		BrowserEndpoint: &browserEndpoint,
		SMTP: &domain.SMTPSettings{
			SenderEmail: "reader@example.com",
			Host:        "smtp.example.com",
			Port:        465,
			Security:    domain.SMTPSecurityTLS,
			User:        &smtpUser,
			Password:    &smtpPassword,
		},
		Kindle: &domain.KindleSettings{
			KindleEmail: "reader@kindle.com",
			SendTime:    &sendTime,
			NextSendAt:  &nextSendAt,
		},
	}

	recorder := h.authed(http.MethodGet, "/api/settings", nil)
	requireStatus(t, recorder, http.StatusOK)
	requireJSONContentType(t, recorder)

	body := recorder.Body.String()
	for _, secret := range []string{jinaKey, browserEndpoint, smtpPassword} {
		if strings.Contains(body, secret) {
			t.Fatalf("settings response leaked %q: %s", secret, body)
		}
	}

	var payload struct {
		Retention                 int    `json:"retention"`
		Provider                  string `json:"provider"`
		JinaKeyConfigured         bool   `json:"jinaKeyConfigured"`
		BrowserEndpointConfigured bool   `json:"browserEndpointConfigured"`
		SMTP                      struct {
			SenderEmail        string `json:"senderEmail"`
			Host               string `json:"host"`
			Port               int    `json:"port"`
			Security           string `json:"security"`
			User               string `json:"user"`
			PasswordConfigured bool   `json:"passwordConfigured"`
		} `json:"smtp"`
		Kindle struct {
			KindleEmail string `json:"kindleEmail"`
			SendTime    string `json:"sendTime"`
			NextSendAt  string `json:"nextSendAt"`
		} `json:"kindle"`
	}
	decodeBody(t, recorder, &payload)

	if payload.Retention != 42 || payload.Provider != "browser" {
		t.Fatalf("settings = %+v", payload)
	}

	if !payload.JinaKeyConfigured || !payload.BrowserEndpointConfigured {
		t.Fatalf("secret flags = %+v", payload)
	}

	if payload.SMTP.SenderEmail != "reader@example.com" || payload.SMTP.Host != "smtp.example.com" || payload.SMTP.Port != 465 || payload.SMTP.Security != "tls" {
		t.Fatalf("smtp = %+v", payload.SMTP)
	}

	if payload.SMTP.User != "smtp-user" || !payload.SMTP.PasswordConfigured {
		t.Fatalf("smtp auth = %+v", payload.SMTP)
	}

	if payload.Kindle.KindleEmail != "reader@kindle.com" || payload.Kindle.SendTime != "08:00" || payload.Kindle.NextSendAt != "2026-03-01T08:30:00Z" {
		t.Fatalf("kindle = %+v", payload.Kindle)
	}

	h.store.settings.SMTP = &domain.SMTPSettings{
		SenderEmail: "reader@example.com",
		Host:        "smtp.example.com",
		Port:        587,
		Security:    domain.SMTPSecuritySTARTTLS,
	}
	h.store.settings.Kindle = &domain.KindleSettings{
		KindleEmail: "reader@kindle.com",
	}

	recorder = h.authed(http.MethodGet, "/api/settings", nil)
	requireStatus(t, recorder, http.StatusOK)

	var partial map[string]any
	decodeBody(t, recorder, &partial)
	smtpObj := partial["smtp"].(map[string]any)
	if _, hasUser := smtpObj["user"]; hasUser {
		t.Fatalf("smtp.user must be omitted when nil: %s", recorder.Body.String())
	}

	if smtpObj["passwordConfigured"] != false {
		t.Fatalf("passwordConfigured = %v", smtpObj["passwordConfigured"])
	}

	kindleObj := partial["kindle"].(map[string]any)
	if _, hasSendTime := kindleObj["sendTime"]; hasSendTime {
		t.Fatalf("kindle.sendTime must be omitted when nil: %s", recorder.Body.String())
	}

	if _, hasNextSendAt := kindleObj["nextSendAt"]; hasNextSendAt {
		t.Fatalf("kindle.nextSendAt must be omitted when nil: %s", recorder.Body.String())
	}

	h.store.settings.SMTP = nil
	h.store.settings.Kindle = nil
	h.store.settings.JinaKey = nil
	h.store.settings.BrowserEndpoint = nil

	recorder = h.authed(http.MethodGet, "/api/settings", nil)
	requireStatus(t, recorder, http.StatusOK)

	var generic map[string]any
	decodeBody(t, recorder, &generic)
	if _, present := generic["smtp"]; present {
		t.Fatalf("smtp must be omitted when unconfigured: %s", recorder.Body.String())
	}

	if _, present := generic["kindle"]; present {
		t.Fatalf("kindle must be omitted when unconfigured: %s", recorder.Body.String())
	}

	if generic["jinaKeyConfigured"] != false || generic["browserEndpointConfigured"] != false {
		t.Fatalf("unconfigured secret flags = %+v", generic)
	}
}

func TestSettingsUpdates(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/retention", map[string]any{"retention": 0}), http.StatusBadRequest, "InvalidRetention")
	requireStatus(t, h.authed(http.MethodPut, "/api/settings/retention", map[string]any{"retention": 25}), http.StatusNoContent)
	if h.store.settings.Retention != 25 {
		t.Fatalf("retention = %d", h.store.settings.Retention)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/provider", map[string]any{"provider": "unknown"}), http.StatusBadRequest, "InvalidProvider")
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/provider", map[string]any{"provider": ""}), http.StatusBadRequest, "InvalidProvider")
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/provider", map[string]any{"provider": "browser"}), http.StatusUnprocessableEntity, "BrowserEndpointRequired")

	requireStatus(t, h.authed(http.MethodPut, "/api/settings/provider", map[string]any{"provider": "jina"}), http.StatusNoContent)
	if h.store.settings.Provider != domain.ProviderJina {
		t.Fatalf("provider = %q", h.store.settings.Provider)
	}

	requireStatus(t, h.authed(http.MethodPut, "/api/settings/provider", map[string]any{"provider": "direct"}), http.StatusNoContent)
	if h.store.settings.Provider != domain.ProviderDirect {
		t.Fatalf("provider = %q", h.store.settings.Provider)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/jina", map[string]any{"key": "   "}), http.StatusBadRequest, "InvalidJinaKey")
	requireStatus(t, h.authed(http.MethodPut, "/api/settings/services/jina", map[string]any{"key": "  jina-key  "}), http.StatusNoContent)
	if h.store.settings.Provider != domain.ProviderDirect || h.store.settings.JinaKey == nil || *h.store.settings.JinaKey != "jina-key" {
		t.Fatalf("jina settings = %+v", h.store.settings)
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/settings/services/jina", nil), http.StatusNoContent)
	if h.store.settings.JinaKey != nil {
		t.Fatal("jina key was not deleted")
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/browser", map[string]any{"endpoint": "   "}), http.StatusBadRequest, "InvalidEndpoint")
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/browser", map[string]any{"endpoint": "ftp://browser:9222"}), http.StatusBadRequest, "InvalidEndpoint")
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/browser", map[string]any{"endpoint": "http://"}), http.StatusBadRequest, "InvalidEndpoint")

	requireStatus(t, h.authed(http.MethodPut, "/api/settings/services/browser", map[string]any{"endpoint": "  http://browser:9222  "}), http.StatusNoContent)
	if h.store.settings.Provider != domain.ProviderDirect || h.store.settings.BrowserEndpoint == nil || *h.store.settings.BrowserEndpoint != "http://browser:9222" {
		t.Fatalf("browser settings = %+v", h.store.settings)
	}

	requireStatus(t, h.authed(http.MethodPut, "/api/settings/provider", map[string]any{"provider": "browser"}), http.StatusNoContent)
	if h.store.settings.Provider != domain.ProviderBrowser {
		t.Fatalf("provider = %q", h.store.settings.Provider)
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/settings/services/browser", nil), http.StatusNoContent)
	if h.store.settings.BrowserEndpoint != nil || h.store.settings.Provider != domain.ProviderDirect {
		t.Fatalf("browser delete did not reset provider: %+v", h.store.settings)
	}
}

func TestSMTPSettingsUpdate(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	body := map[string]any{
		"senderEmail": "reader@example.com",
		"host":        "smtp.example.com",
		"port":        465,
		"security":    "tls",
		"user":        "  smtp-user  ",
		"password":    "smtp-secret",
	}

	requireStatus(t, h.authed(http.MethodPut, "/api/settings/services/smtp", body), http.StatusNoContent)

	stored := h.store.settings.SMTP
	if stored == nil {
		t.Fatal("smtp settings were not stored")
	}

	if stored.SenderEmail != "reader@example.com" || stored.Host != "smtp.example.com" || stored.Port != 465 || stored.Security != domain.SMTPSecurityTLS {
		t.Fatalf("stored smtp = %+v", stored)
	}

	if stored.User == nil || *stored.User != "smtp-user" {
		t.Fatalf("smtp user = %v", stored.User)
	}

	if stored.Password == nil || *stored.Password != "smtp-secret" {
		t.Fatal("smtp password was not stored")
	}

	body["password"] = "   "
	body["user"] = "   "
	requireStatus(t, h.authed(http.MethodPut, "/api/settings/services/smtp", body), http.StatusNoContent)

	stored = h.store.settings.SMTP
	if stored.Password == nil || *stored.Password != "smtp-secret" {
		t.Fatal("blank smtp password must preserve the stored secret")
	}

	if stored.User != nil {
		t.Fatalf("blank user must clear user, got %q", *stored.User)
	}

	invalid := map[string]any{
		"senderEmail": "not-an-email",
		"host":        "smtp.example.com",
		"port":        465,
		"security":    "tls",
	}
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/smtp", invalid), http.StatusBadRequest, "InvalidSMTPSetting")

	invalid["senderEmail"] = "reader@example.com"
	invalid["host"] = "   "
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/smtp", invalid), http.StatusBadRequest, "InvalidSMTPSetting")

	invalid["host"] = "smtp.example.com"
	invalid["port"] = 0
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/smtp", invalid), http.StatusBadRequest, "InvalidSMTPSetting")

	invalid["port"] = 465
	invalid["security"] = "ssl"
	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/services/smtp", invalid), http.StatusBadRequest, "InvalidSMTPSetting")

	requireStatus(t, h.authed(http.MethodDelete, "/api/settings/services/smtp/password", nil), http.StatusNoContent)
	if h.store.settings.SMTP == nil || h.store.settings.SMTP.Password != nil {
		t.Fatalf("smtp password was not deleted: %+v", h.store.settings.SMTP)
	}

	requireStatus(t, h.authed(http.MethodDelete, "/api/settings/services/smtp", nil), http.StatusNoContent)
	if h.store.settings.SMTP != nil {
		t.Fatalf("smtp settings were not deleted: %+v", h.store.settings.SMTP)
	}
}

func TestKindleSettingsUpdate(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	body := map[string]any{
		"kindleEmail": "reader@kindle.com",
		"sendTime":    "09:30",
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/kindle", body), http.StatusUnprocessableEntity, "SMTPNotConfigured")

	requireStatus(t, h.authed(http.MethodPut, "/api/settings/services/smtp", map[string]any{
		"senderEmail": "reader@example.com",
		"host":        "smtp.example.com",
		"port":        465,
		"security":    "tls",
		"password":    "smtp-secret",
	}), http.StatusNoContent)

	requireStatus(t, h.authed(http.MethodPut, "/api/settings/kindle", body), http.StatusNoContent)

	stored := h.store.settings.Kindle
	if stored == nil {
		t.Fatal("kindle settings were not stored")
	}

	if stored.KindleEmail != "reader@kindle.com" {
		t.Fatalf("stored kindle = %+v", stored)
	}

	if stored.SendTime == nil || *stored.SendTime != "09:30" {
		t.Fatalf("send time = %v", stored.SendTime)
	}

	if stored.NextSendAt == nil || stored.NextSendAt.Format(time.RFC3339) != "2026-03-01T09:30:00Z" {
		t.Fatalf("next send at = %v", stored.NextSendAt)
	}

	body["sendTime"] = ""
	requireStatus(t, h.authed(http.MethodPut, "/api/settings/kindle", body), http.StatusNoContent)

	stored = h.store.settings.Kindle
	if stored.SendTime != nil || stored.NextSendAt != nil {
		t.Fatalf("disabled schedule = %v / %v", stored.SendTime, stored.NextSendAt)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/kindle", map[string]any{
		"kindleEmail": "not-an-email",
	}), http.StatusBadRequest, "InvalidKindleSetting")

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/kindle", map[string]any{
		"kindleEmail": "reader@kindle.com",
		"sendTime":    "09:15",
	}), http.StatusBadRequest, "InvalidKindleSetting")

	requireStatus(t, h.authed(http.MethodDelete, "/api/settings/services/smtp", nil), http.StatusNoContent)
	if h.store.settings.Kindle == nil || h.store.settings.Kindle.KindleEmail != "reader@kindle.com" {
		t.Fatalf("clearing smtp must keep kindle address: %+v", h.store.settings.Kindle)
	}

	requireAPIError(t, h.authed(http.MethodPut, "/api/settings/kindle", body), http.StatusUnprocessableEntity, "SMTPNotConfigured")
}

func TestRemovedSettingsRoutes(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	removed := []struct {
		method string
		target string
	}{
		{method: http.MethodPut, target: "/api/settings/fetcher/direct"},
		{method: http.MethodPut, target: "/api/settings/fetcher/jina"},
		{method: http.MethodPut, target: "/api/settings/fetcher/browser"},
		{method: http.MethodDelete, target: "/api/settings/fetcher/jina/key"},
		{method: http.MethodDelete, target: "/api/settings/kindle/password"},
	}

	for _, route := range removed {
		recorder := h.authed(route.method, route.target, nil)
		if recorder.Code != http.StatusNotFound && recorder.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s %s status = %d, want 404 or 405: %s", route.method, route.target, recorder.Code, recorder.Body.String())
		}
	}
}

func TestKindleSend(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	started := time.Date(2026, time.March, 1, 7, 0, 0, 0, time.UTC)
	h.kindle.record = domain.KindleSendRecord{
		ID:        domain.NewID(),
		Trigger:   domain.KindleTriggerManual,
		Status:    domain.KindleStatusRunning,
		StartedAt: started,
	}

	recorder := h.authed(http.MethodPost, "/api/kindle/send", nil)
	requireStatus(t, recorder, http.StatusAccepted)

	var queued itemResponse[kindleSendRecordJSON]
	decodeBody(t, recorder, &queued)
	if queued.Item == nil {
		t.Fatal("send response has no item")
	}

	if queued.Item.Status != domain.KindleStatusRunning || queued.Item.Trigger != domain.KindleTriggerManual {
		t.Fatalf("queued record = %+v", queued.Item)
	}

	if queued.Item.StartedAt != "2026-03-01T07:00:00Z" {
		t.Fatalf("startedAt = %q", queued.Item.StartedAt)
	}

	if h.kindle.calls != 1 {
		t.Fatalf("enqueue calls = %d", h.kindle.calls)
	}

	h.kindle.err = domain.NewError(domain.ErrKindleSendInProgress, nil)
	requireAPIError(t, h.authed(http.MethodPost, "/api/kindle/send", nil), http.StatusConflict, "KindleSendInProgress")

	h.kindle.err = domain.NewError(domain.ErrKindleNotConfigured, nil)
	requireAPIError(t, h.authed(http.MethodPost, "/api/kindle/send", nil), http.StatusUnprocessableEntity, "KindleNotConfigured")
}

func TestKindleSendsList(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	started := time.Date(2026, time.March, 1, 7, 0, 0, 0, time.UTC)
	finished := started.Add(3 * time.Minute)
	h.store.sends = []domain.KindleSendRecord{{
		ID:           domain.NewID(),
		Trigger:      domain.KindleTriggerScheduled,
		Status:       domain.KindleStatusFailed,
		ArticleCount: 5,
		BookCount:    2,
		Error:        strPtr("smtp rejected the message"),
		StartedAt:    started,
		FinishedAt:   &finished,
	}}

	recorder := h.authed(http.MethodGet, "/api/kindle/sends", nil)
	requireStatus(t, recorder, http.StatusOK)

	var payload kindleSendsResponse
	decodeBody(t, recorder, &payload)
	if payload.Running {
		t.Fatal("no send is running")
	}

	if len(payload.Items) != 1 {
		t.Fatalf("sends = %+v", payload.Items)
	}

	record := payload.Items[0]
	if record.Status != domain.KindleStatusFailed || record.ArticleCount != 5 || record.BookCount != 2 {
		t.Fatalf("record = %+v", record)
	}

	if record.Error == nil || *record.Error != "smtp rejected the message" {
		t.Fatalf("record error = %v", record.Error)
	}

	if record.StartedAt != "2026-03-01T07:00:00Z" || record.FinishedAt == nil || *record.FinishedAt != "2026-03-01T07:03:00Z" {
		t.Fatalf("record timestamps = %q / %v", record.StartedAt, record.FinishedAt)
	}

	h.store.sends = append([]domain.KindleSendRecord{{
		ID:        domain.NewID(),
		Trigger:   domain.KindleTriggerManual,
		Status:    domain.KindleStatusRunning,
		StartedAt: started,
	}}, h.store.sends...)

	recorder = h.authed(http.MethodGet, "/api/kindle/sends", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &payload)
	if !payload.Running {
		t.Fatal("a running record must report running = true")
	}
}

func TestKindleEndpointsRequireDispatcher(t *testing.T) {
	t.Parallel()

	h := newHarnessWith(t, func(cfg *Config) { cfg.Kindle = nil })

	requireAPIError(t, h.authed(http.MethodPost, "/api/kindle/send", nil), http.StatusInternalServerError, "RequestFailed")

	recorder := h.authed(http.MethodGet, "/api/kindle/sends", nil)
	requireStatus(t, recorder, http.StatusOK)

	var payload kindleSendsResponse
	decodeBody(t, recorder, &payload)
	if payload.Running || payload.Items == nil || len(payload.Items) != 0 {
		t.Fatalf("sends payload = %+v", payload)
	}

	if !strings.Contains(recorder.Body.String(), `"items":[]`) {
		t.Fatalf("empty sends must serialize as []: %s", recorder.Body.String())
	}
}

func TestStaticSPAFallback(t *testing.T) {
	t.Parallel()

	staticFS := fstest.MapFS{
		"index.html":        &fstest.MapFile{Data: []byte("<!doctype html><html><body>spa-shell</body></html>")},
		"assets/app-123.js": &fstest.MapFile{Data: []byte("console.log('app')")},
		"favicon.ico":       &fstest.MapFile{Data: []byte("icon-bytes")},
	}
	h := newHarnessWith(t, func(cfg *Config) { cfg.StaticFS = staticFS })

	recorder := h.raw(http.MethodGet, "/", nil)
	requireStatus(t, recorder, http.StatusOK)
	if !strings.Contains(recorder.Body.String(), "spa-shell") {
		t.Fatalf("root body = %s", recorder.Body.String())
	}

	if cache := recorder.Header().Get("Cache-Control"); cache != indexCacheControl {
		t.Fatalf("index cache control = %q", cache)
	}

	recorder = h.raw(http.MethodGet, "/later/0190f1f4-0000-7000-8000-000000000000", nil)
	requireStatus(t, recorder, http.StatusOK)
	if !strings.Contains(recorder.Body.String(), "spa-shell") {
		t.Fatalf("spa fallback body = %s", recorder.Body.String())
	}

	recorder = h.raw(http.MethodHead, "/settings", nil)
	requireStatus(t, recorder, http.StatusOK)

	recorder = h.raw(http.MethodGet, "/assets/app-123.js", nil)
	requireStatus(t, recorder, http.StatusOK)
	if body := recorder.Body.String(); body != "console.log('app')" {
		t.Fatalf("asset body = %q", body)
	}

	if cache := recorder.Header().Get("Cache-Control"); cache != immutableCacheControl {
		t.Fatalf("asset cache control = %q", cache)
	}

	recorder = h.raw(http.MethodGet, "/favicon.ico", nil)
	requireStatus(t, recorder, http.StatusOK)
	if body := recorder.Body.String(); body != "icon-bytes" {
		t.Fatalf("favicon body = %q", body)
	}

	if cache := recorder.Header().Get("Cache-Control"); cache != "" {
		t.Fatalf("favicon cache control = %q", cache)
	}

	requireStatus(t, h.raw(http.MethodGet, "/missing.js", nil), http.StatusNotFound)
	requireStatus(t, h.raw(http.MethodPost, "/later", nil), http.StatusMethodNotAllowed)

	recorder = h.authed(http.MethodGet, "/api/does-not-exist", nil)
	requireAPIError(t, recorder, http.StatusNotFound, "RequestFailed")

	recorder = h.authed(http.MethodGet, "/api", nil)
	requireAPIError(t, recorder, http.StatusNotFound, "RequestFailed")

	recorder = h.raw(http.MethodGet, "/healthz", nil)
	requireStatus(t, recorder, http.StatusOK)
}

func TestStaticServingWithoutEmbeddedFS(t *testing.T) {
	t.Parallel()

	h := newHarness(t)

	requireStatus(t, h.raw(http.MethodGet, "/", nil), http.StatusNotFound)
	requireStatus(t, h.raw(http.MethodGet, "/later", nil), http.StatusNotFound)
}

func TestListEndpointsHonorOrder(t *testing.T) {
	t.Parallel()

	h := newHarness(t)
	folder := h.seedFolder("Tech")
	feed := h.seedFeed("Go Blog", "https://feeds.example.com/rss", &folder.ID)
	firstItem := h.seedItem(feed.ID, "https://example.com/a", nil)
	secondItem := h.seedItem(feed.ID, "https://example.com/b", nil)
	thirdItem := h.seedItem(feed.ID, "https://example.com/c", nil)
	firstPage := h.seedSavedPage("https://example.com/1", false)
	secondPage := h.seedSavedPage("https://example.com/2", false)

	for _, target := range []string{"/api/feed-items", "/api/folders/" + folder.ID + "/items"} {
		var page pageResponse[feedItemJSON]
		recorder := h.authed(http.MethodGet, target+"?order=oldest&limit=2", nil)
		requireStatus(t, recorder, http.StatusOK)
		decodeBody(t, recorder, &page)
		if len(page.Items) != 2 || page.Items[0].ID != firstItem.ID || page.Items[1].ID != secondItem.ID {
			t.Fatalf("%s oldest page = %+v", target, page.Items)
		}

		if page.Cursor == nil || *page.Cursor != secondItem.ID {
			t.Fatalf("%s oldest cursor = %v", target, page.Cursor)
		}

		recorder = h.authed(http.MethodGet, target+"?order=oldest&limit=2&cursor="+*page.Cursor, nil)
		requireStatus(t, recorder, http.StatusOK)
		decodeBody(t, recorder, &page)
		if len(page.Items) != 1 || page.Items[0].ID != thirdItem.ID || page.Cursor != nil {
			t.Fatalf("%s oldest continuation = %+v", target, page)
		}

		recorder = h.authed(http.MethodGet, target+"?order=newest", nil)
		requireStatus(t, recorder, http.StatusOK)
		decodeBody(t, recorder, &page)
		if len(page.Items) != 3 || page.Items[0].ID != thirdItem.ID {
			t.Fatalf("%s explicit newest = %+v", target, page.Items)
		}

		recorder = h.authed(http.MethodGet, target, nil)
		requireStatus(t, recorder, http.StatusOK)
		decodeBody(t, recorder, &page)
		if len(page.Items) != 3 || page.Items[0].ID != thirdItem.ID {
			t.Fatalf("%s default order = %+v", target, page.Items)
		}

		requireAPIError(t, h.authed(http.MethodGet, target+"?order=bogus", nil), http.StatusBadRequest, "RequestFailed")
	}

	var saved pageResponse[savedPageJSON]
	recorder := h.authed(http.MethodGet, "/api/saved-pages?order=oldest", nil)
	requireStatus(t, recorder, http.StatusOK)
	decodeBody(t, recorder, &saved)
	if len(saved.Items) != 2 || saved.Items[0].ID != firstPage.ID || saved.Items[1].ID != secondPage.ID {
		t.Fatalf("saved pages oldest = %+v", saved.Items)
	}

	requireAPIError(t, h.authed(http.MethodGet, "/api/saved-pages?order=bogus", nil), http.StatusBadRequest, "RequestFailed")
}
