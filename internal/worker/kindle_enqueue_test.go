package worker

import (
	"context"
	"errors"
	"fmt"
	"reader/internal/domain"
	"slices"
	"sync"
	"testing"
	"time"
)

func TestEnqueueManualRejectsUnconfiguredKindle(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		configure func(settings *domain.Settings)
	}{
		{
			name: "missing smtp and kindle settings",
			configure: func(settings *domain.Settings) {
				settings.SMTP = nil
				settings.Kindle = nil
			},
		},
		{
			name: "smtp configured but kindle nil",
			configure: func(settings *domain.Settings) {
				settings.Kindle = nil
			},
		},
		{
			name: "kindle configured but smtp nil",
			configure: func(settings *domain.Settings) {
				settings.SMTP = nil
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			settings := configuredDeliverySettings()
			tc.configure(&settings)

			sender := newTestKindleSender(t, KindleConfig{
				KindleSends: &fakeKindleSendRepository{settingsRepo: &fakeSettingRepository{settings: settings}},
				EPUBBuilder: &fakeEPUBBuilder{},
				MailSender:  &fakeMailSender{},
			})

			_, err := sender.EnqueueManual(context.Background())
			requireErrorCode(t, err, domain.ErrKindleNotConfigured)

			if sender.IsRunning() {
				t.Fatal("IsRunning() = true after rejected enqueue")
			}
		})
	}
}

func TestEnqueueManualReturnsClaimError(t *testing.T) {
	t.Parallel()

	want := errors.New("claim failed")
	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: &fakeKindleSendRepository{claimErr: want},
	})

	if _, err := sender.EnqueueManual(context.Background()); !errors.Is(err, want) {
		t.Fatalf("EnqueueManual() error = %v, want %v", err, want)
	}

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after the job finished")
	}
}

func TestCompleteSendKeepsStableFinishTimestamp(t *testing.T) {
	t.Parallel()

	for _, failures := range []int{3, 5} {
		t.Run(fmt.Sprintf("%d retries preserve first captured timestamp", failures), func(t *testing.T) {
			t.Parallel()

			t0 := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
			wantFinishedAt := t0.Add(5 * time.Minute)

			var clockMu sync.Mutex
			currentTime := t0
			advanceTo := func(next time.Time) {
				clockMu.Lock()
				currentTime = next
				clockMu.Unlock()
			}
			advanceBy := func(d time.Duration) {
				clockMu.Lock()
				currentTime = currentTime.Add(d)
				clockMu.Unlock()
			}

			sends := &fakeKindleSendRepository{
				completeFailure: failures,
				onList: func() {
					advanceTo(wantFinishedAt)
				},
				onComplete: func(err error) {
					if err != nil {
						advanceBy(time.Minute)
					}
				},
			}

			sender := newTestKindleSender(t, KindleConfig{
				KindleSends: sends,
				EPUBBuilder: &fakeEPUBBuilder{},
				MailSender:  &fakeMailSender{},
				Now: func() time.Time {
					clockMu.Lock()
					defer clockMu.Unlock()

					return currentTime
				},
			})
			sender.completeBaseBackoff = time.Millisecond

			if _, err := sender.EnqueueManual(context.Background()); err != nil {
				t.Fatalf("EnqueueManual() error = %v", err)
			}

			sender.Wait()

			completed := sends.completedList()
			if len(completed) != failures+1 {
				t.Fatalf("completed attempts = %d, want %d", len(completed), failures+1)
			}

			for i, c := range completed {
				if !c.finishedAt.Equal(wantFinishedAt) {
					t.Fatalf("attempt %d finishedAt = %v, want %v", i, c.finishedAt, wantFinishedAt)
				}
			}
			if completed[len(completed)-1].status != domain.KindleStatusSucceeded || sends.hasRunningRow() || sender.IsRunning() {
				t.Fatal("terminal success was not committed")
			}
		})
	}

	t.Run("detached write on cancel preserves first captured timestamp", func(t *testing.T) {
		t.Parallel()

		t0 := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
		wantFinishedAt := t0.Add(5 * time.Minute)

		var clockMu sync.Mutex
		currentTime := t0
		baseCtx, cancelBase := context.WithCancel(context.Background())
		defer cancelBase()

		sends := &fakeKindleSendRepository{
			completeFailure: 1,
			onList: func() {
				clockMu.Lock()
				currentTime = wantFinishedAt
				clockMu.Unlock()
			},
			onComplete: func(err error) {
				if err != nil {
					clockMu.Lock()
					currentTime = currentTime.Add(time.Minute)
					clockMu.Unlock()
					cancelBase()
				}
			},
		}

		sender := newTestKindleSender(t, KindleConfig{
			BaseCtx:     baseCtx,
			KindleSends: sends,
			EPUBBuilder: &fakeEPUBBuilder{},
			MailSender:  &fakeMailSender{},
			Now: func() time.Time {
				clockMu.Lock()
				defer clockMu.Unlock()

				return currentTime
			},
		})
		sender.completeBaseBackoff = time.Hour

		if _, err := sender.EnqueueManual(context.Background()); err != nil {
			t.Fatalf("EnqueueManual() error = %v", err)
		}

		sender.Wait()

		completed := sends.completedList()
		if len(completed) != 2 {
			t.Fatalf("completed attempts = %d, want 2", len(completed))
		}

		for i, c := range completed {
			if !c.finishedAt.Equal(wantFinishedAt) {
				t.Fatalf("attempt %d finishedAt = %v, want %v", i, c.finishedAt, wantFinishedAt)
			}
		}
	})
}

func TestEnqueueManualRunsJob(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 17, 0, 0, 0, time.UTC)
	publishedAt := time.Date(2026, 3, 13, 9, 30, 0, 0, time.UTC)

	deliverySettings := configuredDeliverySettings()
	deliverySettings.Kindle.Schedule = &domain.KindleSchedule{Hour: 9, Timezone: "Asia/Shanghai"}

	page := domain.SavedPage{
		ID:          "page-1",
		URL:         testURL(t, "https://example.com/page"),
		Title:       "Saved Page",
		Content:     "<p>saved</p>",
		PublishedAt: &publishedAt,
	}
	feed := domain.Feed{
		ID:         "feed-1",
		URL:        testURL(t, "https://example.com/feed.xml"),
		Title:      "Example Feed",
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
	}
	item := domain.FeedItem{
		ID:          "item-1",
		FeedID:      "feed-1",
		URL:         testURL(t, "https://example.com/item"),
		Title:       "Feed Item",
		Content:     ptrTo("<p>item</p>"),
		PublishedAt: &publishedAt,
	}

	sends := &fakeKindleSendRepository{
		settingsRepo: &fakeSettingRepository{settings: deliverySettings},
		savedPages:   []domain.SavedPage{page},
		feeds:        []domain.Feed{feed},
		items:        map[string][]domain.FeedItem{"feed-1": {item}},
	}

	builder := &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
		return []domain.EPUBBook{{
			Title:        "Lantern " + dateStr,
			Filename:     "lantern.epub",
			SavedPageIDs: []string{"page-1"},
			FeedItemIDs:  []string{"item-1"},
			ArticleCount: 2,
		}}, nil
	}}
	mailer := &fakeMailSender{}

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		FeedItems:   &fakeFeedItemRepository{},
		EPUBBuilder: builder,
		MailSender:  mailer,
		Now:         func() time.Time { return now },
	})

	rec, err := sender.EnqueueManual(context.Background())
	if err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	if rec.ID == "" {
		t.Fatal("record ID = empty, want generated id")
	}

	if rec.Trigger != domain.KindleTriggerManual {
		t.Fatalf("record trigger = %s, want %s", rec.Trigger, domain.KindleTriggerManual)
	}

	if rec.Status != domain.KindleStatusRunning {
		t.Fatalf("record status = %s, want %s", rec.Status, domain.KindleStatusRunning)
	}

	if !rec.StartedAt.Equal(now) {
		t.Fatalf("record startedAt = %v, want %v", rec.StartedAt, now)
	}

	if !sender.IsRunning() {
		t.Fatal("IsRunning() = false right after enqueue")
	}

	sender.Wait()

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after job finished")
	}

	captured := builder.captured()
	if captured.dateStr != "" {
		t.Fatalf("build dateStr = %q, want none for a manual send", captured.dateStr)
	}

	if captured.language != domain.KindleLanguageChinese {
		t.Fatalf("build language = %q, want the snapshotted %q", captured.language, domain.KindleLanguageChinese)
	}

	if len(captured.articles) != 2 {
		t.Fatalf("articles = %d, want 2", len(captured.articles))
	}

	savedArticle := captured.articles[0]
	if !savedArticle.IsSavedPage || savedArticle.ID != "page-1" || savedArticle.SourceTitle != "example.com" || savedArticle.Section != "稍后阅读" {
		t.Fatalf("saved page article = %+v", savedArticle)
	}

	if savedArticle.HTMLBody != "<p>saved</p>" || savedArticle.URL != "https://example.com/page" {
		t.Fatalf("saved page body/url = %q/%q", savedArticle.HTMLBody, savedArticle.URL)
	}

	feedArticle := captured.articles[1]
	if feedArticle.IsSavedPage || feedArticle.ID != "item-1" || feedArticle.SourceTitle != "Example Feed" || feedArticle.Section != "Example Feed" {
		t.Fatalf("feed article = %+v", feedArticle)
	}

	if feedArticle.HTMLBody != "<p>item</p>" {
		t.Fatalf("feed article body = %q, want %q", feedArticle.HTMLBody, "<p>item</p>")
	}

	accepted := sends.acceptedList()
	if len(accepted) != 1 {
		t.Fatalf("accepted books = %d, want 1", len(accepted))
	}

	if accepted[0].sendID != rec.ID || !slices.Equal(accepted[0].savedPageIDs, []string{"page-1"}) || !slices.Equal(accepted[0].feedItemIDs, []string{"item-1"}) {
		t.Fatalf("accepted book = %+v", accepted[0])
	}

	if accepted[0].articleDelta != 2 {
		t.Fatalf("accepted article delta = %d, want 2", accepted[0].articleDelta)
	}

	completed := sends.completedList()
	if len(completed) != 1 {
		t.Fatalf("completed sends = %d, want 1", len(completed))
	}

	if completed[0].status != domain.KindleStatusSucceeded || completed[0].errSummary != nil {
		t.Fatalf("completed send = %+v", completed[0])
	}

	if !completed[0].finishedAt.Equal(now) {
		t.Fatalf("finishedAt = %v, want %v", completed[0].finishedAt, now)
	}

	mails := mailer.sentList()
	if len(mails) != 1 {
		t.Fatalf("sent mails = %d, want 1", len(mails))
	}

	if mails[0].delivery.SMTP.Host != "smtp.example.com" {
		t.Fatalf("mail SMTP host = %q, want smtp.example.com", mails[0].delivery.SMTP.Host)
	}
}

func TestEnqueueManualIgnoresUnloadableScheduleTimezone(t *testing.T) {
	t.Parallel()

	deliverySettings := configuredDeliverySettings()
	deliverySettings.Kindle.Schedule = &domain.KindleSchedule{Hour: 9, Timezone: "Mars/Olympus_Mons"}

	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	sends := &fakeKindleSendRepository{
		settingsRepo: &fakeSettingRepository{settings: deliverySettings},
		savedPages:   []domain.SavedPage{page},
	}
	builder := &fakeEPUBBuilder{}
	mailer := &fakeMailSender{}

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: builder,
		MailSender:  mailer,
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	completed := sends.completedList()
	if len(completed) != 1 || completed[0].status != domain.KindleStatusSucceeded {
		t.Fatalf("completed sends = %+v, want one succeeded send", completed)
	}

	if builder.callCount() != 1 || builder.captured().dateStr != "" {
		t.Fatalf("epub builds = %d, date = %q, want one build without a date", builder.callCount(), builder.captured().dateStr)
	}
}

func TestEnqueueManualRejectsConcurrentSend(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)

	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	sends := &fakeKindleSendRepository{savedPages: []domain.SavedPage{page}}

	started := make(chan struct{}, 1)
	release := make(chan struct{})
	builder := &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
		started <- struct{}{}
		<-release

		return nil, nil
	}}

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		FeedItems:   &fakeFeedItemRepository{},
		EPUBBuilder: builder,
		MailSender:  &fakeMailSender{},
		Now:         func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("first EnqueueManual() error = %v", err)
	}

	select {
	case <-started:
	case <-time.After(testWaitTimeout):
		t.Fatal("timed out waiting for job to start")
	}

	if !sender.IsRunning() {
		t.Fatal("IsRunning() = false while job is running")
	}

	if _, err := sender.EnqueueManual(context.Background()); err == nil {
		t.Fatal("second EnqueueManual() error = nil, want KindleSendInProgress")
	} else {
		requireErrorCode(t, err, domain.ErrKindleSendInProgress)
	}

	close(release)
	sender.Wait()

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after job finished")
	}
}

func TestFeedItemArticleUsesFolderAsSection(t *testing.T) {
	t.Parallel()

	feed := &domain.Feed{ID: "feed-1", Title: "Example Feed", ReaderMode: domain.ReaderModeDefault}
	item := &domain.FeedItem{ID: "item-1", FeedID: feed.ID, Title: "Item"}
	folderName := "Tech"

	inFolder, ok := (&KindleSender{}).feedItemArticle(context.Background(), feed, item, &folderName)
	if !ok || inFolder.Section != "Tech" || inFolder.SourceTitle != "Example Feed" {
		t.Fatalf("folder feed article = %+v, want section Tech and source Example Feed", inFolder)
	}

	topLevel, ok := (&KindleSender{}).feedItemArticle(context.Background(), feed, item, nil)
	if !ok || topLevel.Section != "Example Feed" {
		t.Fatalf("top-level feed article = %+v, want section Example Feed", topLevel)
	}
}
