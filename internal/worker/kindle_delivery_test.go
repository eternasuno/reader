package worker

import (
	"context"
	"errors"
	"reader/internal/domain"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestRunJobEmptyUnreadSucceedsWithoutMail(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	sends := &fakeKindleSendRepository{}
	builder := &fakeEPUBBuilder{}
	mailer := &fakeMailSender{}

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: builder,
		MailSender:  mailer,
		Now:         func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	if builder.callCount() != 0 {
		t.Fatalf("BuildBooks calls = %d, want 0", builder.callCount())
	}

	if len(mailer.sentList()) != 0 {
		t.Fatal("SendEPUB called for an empty library")
	}

	completed := sends.completedList()
	if len(completed) != 1 || completed[0].status != domain.KindleStatusSucceeded || completed[0].errSummary != nil {
		t.Fatalf("completed sends = %+v", completed)
	}
}

func TestCompleteSendStopsRetryingWhenBaseCtxCanceled(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	baseCtx, cancelBase := context.WithCancel(context.Background())
	defer cancelBase()

	sends := &fakeKindleSendRepository{completeFailure: 100}
	sender := newTestKindleSender(t, KindleConfig{
		BaseCtx:     baseCtx,
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{},
		MailSender:  &fakeMailSender{},
		Now:         func() time.Time { return now },
	})
	sender.completeBaseBackoff = 2 * time.Millisecond

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	waitFor(t, func() bool { return sends.completeCallsList() >= 2 }, "terminal retry attempts")
	cancelBase()

	done := make(chan struct{})
	go func() {
		sender.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(testWaitTimeout):
		t.Fatal("Wait() did not return after BaseCtx cancellation")
	}

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after shutdown")
	}
}

func TestCompleteSendWritesKnownOutcomeWhenCanceledDuringBackoff(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	baseCtx, cancelBase := context.WithCancel(context.Background())
	defer cancelBase()

	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	book := domain.EPUBBook{Title: "book-1", SavedPageIDs: []string{"page-1"}, ArticleCount: 1}
	sends := &fakeKindleSendRepository{savedPages: []domain.SavedPage{page}, completeFailure: 1}
	mailer := &fakeMailSender{}

	sender := newTestKindleSender(t, KindleConfig{
		BaseCtx:     baseCtx,
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
			return []domain.EPUBBook{book}, nil
		}},
		MailSender: mailer,
		Now:        func() time.Time { return now },
	})
	sender.recordBaseBackoff = time.Millisecond

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	// The book is delivered and the first terminal write fails, so the job now
	// sleeps in its terminal-write backoff.
	waitFor(t, func() bool { return sends.completeCallsList() == 1 }, "first terminal write attempt")
	cancelBase()

	done := make(chan struct{})
	go func() {
		sender.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(testWaitTimeout):
		t.Fatal("Wait() did not return after BaseCtx cancellation during backoff")
	}

	if sent := mailer.sentList(); len(sent) != 1 {
		t.Fatalf("mails sent = %d, want 1", len(sent))
	}

	if accepted := sends.acceptedList(); len(accepted) != 1 {
		t.Fatalf("accepted books = %d, want 1", len(accepted))
	}

	completed := sends.completedList()
	if len(completed) != 2 {
		t.Fatalf("CompleteSend calls = %d, want the failed attempt plus one detached write", len(completed))
	}

	for i, write := range completed {
		if write.status != domain.KindleStatusSucceeded || write.errSummary != nil {
			t.Fatalf("write %d = %+v, want the known succeeded outcome without an error", i, write)
		}
	}

	detached := completed[1]
	if detached.ctxErr != nil || !detached.hasDeadline {
		t.Fatalf("final write ctx err = %v, deadline = %v, want a live bounded context", detached.ctxErr, detached.hasDeadline)
	}

	if sends.hasRunningRow() {
		t.Fatal("send is still persisted as running after shutdown")
	}

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after the job finished")
	}
}

func TestDeliverBooksUsesDetachedRecordContextAndChecksCancelBeforeNextBook(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	baseCtx, cancelBase := context.WithCancel(context.Background())
	defer cancelBase()

	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	books := []domain.EPUBBook{
		{Title: "book-1", SavedPageIDs: []string{"page-1"}, ArticleCount: 1},
		{Title: "book-2", FeedItemIDs: []string{"item-1"}, ArticleCount: 1},
	}

	var recordCtxErr error
	sends := &fakeKindleSendRepository{
		savedPages: []domain.SavedPage{page},
		onRecord: func(ctx context.Context) {
			recordCtxErr = ctx.Err()
		},
	}

	mailCalls := 0
	mailer := &fakeMailSender{
		send: func(ctx context.Context, delivery domain.KindleDelivery, book domain.EPUBBook) error {
			mailCalls++
			// Cancel job context right as book 1 is accepted by SMTP.
			cancelBase()

			return nil
		},
	}

	sender := newTestKindleSender(t, KindleConfig{
		BaseCtx:     baseCtx,
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
			return books, nil
		}},
		MailSender: mailer,
		Now:        func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	if mailCalls != 1 {
		t.Fatalf("SendEPUB calls = %d, want 1 (book 2 must not start after cancel)", mailCalls)
	}

	if recordCtxErr != nil {
		t.Fatalf("RecordBookAccepted ctx.Err() = %v, want nil detached context", recordCtxErr)
	}

	if accepted := sends.acceptedList(); len(accepted) != 1 || accepted[0].bookIndex != 0 || !slices.Equal(accepted[0].savedPageIDs, []string{"page-1"}) {
		t.Fatalf("accepted books = %+v, want book 1 recorded despite cancel", accepted)
	}

	completed := sends.completedList()
	if len(completed) != 1 || completed[0].status != domain.KindleStatusFailed {
		t.Fatalf("completed sends = %+v, want failed after cancel", completed)
	}
}

func TestRunJobRetriesRecordBookAcceptedWithoutResendingMail(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	books := []domain.EPUBBook{
		{Title: "book-1", SavedPageIDs: []string{"page-1"}, ArticleCount: 1},
		{Title: "book-2", FeedItemIDs: []string{"item-1"}, ArticleCount: 1},
	}

	sends := &fakeKindleSendRepository{
		savedPages:    []domain.SavedPage{page},
		recordFailure: 2,
	}
	mailer := &fakeMailSender{}

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
			return books, nil
		}},
		MailSender: mailer,
		Now:        func() time.Time { return now },
	})
	sender.recordBaseBackoff = time.Millisecond

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	if sent := mailer.sentList(); len(sent) != 2 {
		t.Fatalf("mails sent = %d, want 2 (one per book)", len(sent))
	}

	if calls := sends.recordCallsList(); calls != 4 {
		t.Fatalf("RecordBookAccepted calls = %d, want 4", calls)
	}

	accepted := sends.acceptedList()
	if len(accepted) != 2 || accepted[0].bookIndex != 0 || accepted[1].bookIndex != 1 {
		t.Fatalf("accepted books = %+v, want book indexes 0 and 1", accepted)
	}

	completed := sends.completedList()
	if len(completed) != 1 || completed[0].status != domain.KindleStatusSucceeded || completed[0].errSummary != nil {
		t.Fatalf("completed sends = %+v, want succeeded", completed)
	}
}

func TestRunJobCompletesWithoutCanceledContext(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	sends := &fakeKindleSendRepository{savedPages: []domain.SavedPage{page}}

	baseCtx, cancelBase := context.WithCancel(context.Background())
	defer cancelBase()

	sender := newTestKindleSender(t, KindleConfig{
		BaseCtx:     baseCtx,
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
			cancelBase()

			return nil, context.Canceled
		}},
		MailSender: &fakeMailSender{},
		Now:        func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	completed := sends.completedList()
	if len(completed) != 1 || completed[0].status != domain.KindleStatusFailed {
		t.Fatalf("completed sends = %+v, want one failed send", completed)
	}

	if completed[0].ctxErr != nil || !completed[0].hasDeadline {
		t.Fatalf("completion context error = %v, deadline = %v; want live and deadline-bound", completed[0].ctxErr, completed[0].hasDeadline)
	}
	if sends.hasRunningRow() {
		t.Fatal("running row remains after completion")
	}
}

func TestRunJobFailures(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	book := domain.EPUBBook{Title: "book", Filename: "book.epub", SavedPageIDs: []string{"page-1"}, ArticleCount: 1}

	cases := []struct {
		name        string
		configure   func(sends *fakeKindleSendRepository, builder *fakeEPUBBuilder, mailer *fakeMailSender)
		wantSummary string
		wantCreated int
	}{
		{
			name: "unread list failure",
			configure: func(sends *fakeKindleSendRepository, builder *fakeEPUBBuilder, mailer *fakeMailSender) {
				sends.listErr = errors.New("list failed for https://alice:secret@example.com/x")
			},
			wantSummary: "list failed for https://example.com/x",
			wantCreated: 1,
		},
		{
			name: "epub build failure",
			configure: func(sends *fakeKindleSendRepository, builder *fakeEPUBBuilder, mailer *fakeMailSender) {
				builder.build = func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
					return nil, errors.New("build failed")
				}
			},
			wantSummary: "build failed",
			wantCreated: 1,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			sends := &fakeKindleSendRepository{savedPages: []domain.SavedPage{page}}
			builder := &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
				return []domain.EPUBBook{book}, nil
			}}
			mailer := &fakeMailSender{}
			tc.configure(sends, builder, mailer)

			sender := newTestKindleSender(t, KindleConfig{
				KindleSends: sends,
				EPUBBuilder: builder,
				MailSender:  mailer,
				Now:         func() time.Time { return now },
			})

			if _, err := sender.EnqueueManual(context.Background()); err != nil {
				t.Fatalf("EnqueueManual() error = %v", err)
			}

			sender.Wait()

			completed := sends.completedList()
			if len(completed) != 1 {
				t.Fatalf("completed sends = %d, want 1", len(completed))
			}

			if completed[0].status != domain.KindleStatusFailed {
				t.Fatalf("completed status = %s, want failed", completed[0].status)
			}

			if completed[0].errSummary == nil || *completed[0].errSummary != tc.wantSummary {
				t.Fatalf("completed summary = %v, want %q", completed[0].errSummary, tc.wantSummary)
			}

			if strings.Contains(*completed[0].errSummary, "alice:secret") {
				t.Fatalf("summary leaks credentials: %q", *completed[0].errSummary)
			}

			if want := tc.wantCreated; len(sends.createdList()) != want {
				t.Fatalf("created sends = %d, want %d", len(sends.createdList()), want)
			}
		})
	}
}

func TestRunJobStopsAfterMailFailure(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}

	books := []domain.EPUBBook{
		{Title: "book-1", SavedPageIDs: []string{"page-1"}, ArticleCount: 1},
		{Title: "book-2", FeedItemIDs: []string{"item-1"}, ArticleCount: 1},
	}

	sends := &fakeKindleSendRepository{savedPages: []domain.SavedPage{page}}
	builder := &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
		return books, nil
	}}

	mailCalls := 0
	mailer := &fakeMailSender{}
	mailer.send = func(ctx context.Context, delivery domain.KindleDelivery, book domain.EPUBBook) error {
		mailCalls++
		if mailCalls == 2 {
			return errors.New("smtp rejected book")
		}

		return nil
	}

	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: builder,
		MailSender:  mailer,
		Now:         func() time.Time { return now },
	})

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	if mailCalls != 2 {
		t.Fatalf("SendEPUB calls = %d, want 2", mailCalls)
	}

	accepted := sends.acceptedList()
	if len(accepted) != 1 || !slices.Equal(accepted[0].savedPageIDs, []string{"page-1"}) {
		t.Fatalf("accepted books = %+v, want only the first book", accepted)
	}

	completed := sends.completedList()
	if len(completed) != 1 || completed[0].status != domain.KindleStatusFailed {
		t.Fatalf("completed sends = %+v, want one failed send", completed)
	}

	if completed[0].errSummary == nil || *completed[0].errSummary != "smtp rejected book" {
		t.Fatalf("summary = %v, want %q", completed[0].errSummary, "smtp rejected book")
	}
}

func TestTerminalStatusRetriesTransientFailureWithinBudget(t *testing.T) {
	t.Parallel()

	sends := &fakeKindleSendRepository{completeFailure: 2}
	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{},
		MailSender:  &fakeMailSender{},
	})
	sender.completeRetryBudget = time.Second
	sender.completeBaseBackoff = time.Millisecond

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatal(err)
	}

	done := make(chan struct{})
	go func() { sender.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(testWaitTimeout):
		t.Fatal("Wait() did not finish after transient retries")
	}

	completed := sends.completedList()
	if len(completed) != 3 || completed[2].status != domain.KindleStatusSucceeded {
		t.Fatalf("completed = %+v, want 2 failed attempts then succeeded", completed)
	}

	if sender.IsRunning() || sends.hasRunningRow() {
		t.Fatalf("running = %v, row running = %v, want both false", sender.IsRunning(), sends.hasRunningRow())
	}
}

func TestTerminalStatusReportsFatalAfterBudgetExhaustion(t *testing.T) {
	t.Parallel()

	repoErr := errors.New("db error for https://alice:secret@example.com/db")
	var fatals fatalRecorder

	sends := &fakeKindleSendRepository{completeErr: repoErr}
	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{},
		MailSender:  &fakeMailSender{},
		OnFatal:     fatals.Record,
	})
	sender.completeRetryBudget = 15 * time.Millisecond
	sender.completeBaseBackoff = time.Millisecond

	record, err := sender.EnqueueManual(context.Background())
	if err != nil {
		t.Fatal(err)
	}

	done := make(chan struct{})
	go func() { sender.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(testWaitTimeout):
		t.Fatal("Wait() did not return after retry budget exhausted")
	}

	gotFatal := fatals.Errors()
	if len(gotFatal) != 1 {
		t.Fatalf("OnFatal calls = %d, want 1", len(gotFatal))
	}

	fatalErr := gotFatal[0]
	if !errors.Is(fatalErr, repoErr) {
		t.Fatalf("fatal error = %v, want wrapping %v", fatalErr, repoErr)
	}

	if !strings.Contains(fatalErr.Error(), record.ID) || !strings.Contains(fatalErr.Error(), string(domain.KindleStatusSucceeded)) {
		t.Fatalf("fatal error %q missing send_id %q or status", fatalErr.Error(), record.ID)
	}

	if strings.Contains(fatalErr.Error(), "alice:secret") {
		t.Fatalf("fatal error leaks credentials: %q", fatalErr.Error())
	}

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after fatal terminal write failure")
	}
}

func TestTerminalStatusReleasesSlotWithoutFatalOnMissingSend(t *testing.T) {
	t.Parallel()

	sends := &fakeKindleSendRepository{completeErr: domain.ErrKindleSendNotFound}
	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{},
		MailSender:  &fakeMailSender{},
	})
	sender.completeRetryBudget = time.Second
	sender.completeBaseBackoff = time.Hour

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatal(err)
	}

	done := make(chan struct{})
	go func() { sender.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(testWaitTimeout):
		t.Fatal("send did not release slot")
	}

	if sends.completeCallsList() != 1 || sender.IsRunning() {
		t.Fatalf("attempts = %d, running = %v, want 1 and false", sends.completeCallsList(), sender.IsRunning())
	}
}

func TestRecordBookAcceptedReportsFatalAfterRetriesExhausted(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	books := []domain.EPUBBook{
		{Title: "book-1", SavedPageIDs: []string{"page-1"}, ArticleCount: 1},
		{Title: "book-2", FeedItemIDs: []string{"item-1"}, ArticleCount: 1},
	}

	repoErr := errors.New("record failed for https://alice:secret@example.com/db")
	var fatals fatalRecorder

	sends := &fakeKindleSendRepository{
		savedPages: []domain.SavedPage{page},
		recordErr:  repoErr,
	}
	mailer := &fakeMailSender{}
	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
			return books, nil
		}},
		MailSender: mailer,
		Now:        func() time.Time { return now },
		OnFatal:    fatals.Record,
	})
	sender.recordBaseBackoff = time.Millisecond

	record, err := sender.EnqueueManual(context.Background())
	if err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	if sent := mailer.sentList(); len(sent) != 1 {
		t.Fatalf("mails sent = %d, want 1", len(sent))
	}

	if calls := sends.recordCallsList(); calls != 3 {
		t.Fatalf("RecordBookAccepted calls = %d, want 3", calls)
	}

	if accepted := sends.acceptedList(); len(accepted) != 0 {
		t.Fatalf("accepted books = %+v, want none", accepted)
	}

	gotFatal := fatals.Errors()
	if len(gotFatal) != 1 {
		t.Fatalf("OnFatal calls = %d, want 1", len(gotFatal))
	}

	fatalErr := gotFatal[0]
	if !errors.Is(fatalErr, repoErr) {
		t.Fatalf("fatal error = %v, want wrapping %v", fatalErr, repoErr)
	}

	if !strings.Contains(fatalErr.Error(), record.ID) || !strings.Contains(fatalErr.Error(), "book_index=0") {
		t.Fatalf("fatal error %q missing send_id %q or book_index=0", fatalErr.Error(), record.ID)
	}

	if strings.Contains(fatalErr.Error(), "alice:secret") {
		t.Fatalf("fatal error leaks credentials: %q", fatalErr.Error())
	}

	completed := sends.completedList()
	if len(completed) != 1 || completed[0].status != domain.KindleStatusFailed {
		t.Fatalf("completed sends = %+v, want failed", completed)
	}

	if completed[0].errSummary == nil || *completed[0].errSummary != "record failed for https://example.com/db" {
		t.Fatalf("completed summary = %v, want sanitized error", completed[0].errSummary)
	}

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after fatal receipt failure")
	}
}

func TestRecordBookAcceptedDoesNotReportFatalOnShutdown(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	baseCtx, cancelBase := context.WithCancel(context.Background())
	defer cancelBase()

	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	book := domain.EPUBBook{Title: "book-1", SavedPageIDs: []string{"page-1"}, ArticleCount: 1}

	sends := &fakeKindleSendRepository{
		savedPages: []domain.SavedPage{page},
		recordErr:  errors.New("record failed"),
		onRecord: func(context.Context) {
			cancelBase()
		},
	}
	sender := newTestKindleSender(t, KindleConfig{
		BaseCtx:     baseCtx,
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
			return []domain.EPUBBook{book}, nil
		}},
		MailSender: &fakeMailSender{},
		Now:        func() time.Time { return now },
	})
	sender.recordBaseBackoff = time.Millisecond

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	if calls := sends.recordCallsList(); calls != 3 {
		t.Fatalf("RecordBookAccepted calls = %d, want 3", calls)
	}

	completed := sends.completedList()
	if len(completed) != 1 || completed[0].status != domain.KindleStatusFailed {
		t.Fatalf("completed sends = %+v, want failed", completed)
	}

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after shutdown")
	}
}

func TestRecordBookAcceptedDoesNotReportFatalOnMissingSend(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 3, 14, 8, 0, 0, 0, time.UTC)
	page := domain.SavedPage{ID: "page-1", URL: testURL(t, "https://example.com/page"), Title: "Page", Content: "body"}
	book := domain.EPUBBook{Title: "book-1", SavedPageIDs: []string{"page-1"}, ArticleCount: 1}

	sends := &fakeKindleSendRepository{
		savedPages: []domain.SavedPage{page},
		recordErr:  domain.ErrKindleSendNotFound,
	}
	sender := newTestKindleSender(t, KindleConfig{
		KindleSends: sends,
		EPUBBuilder: &fakeEPUBBuilder{build: func(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
			return []domain.EPUBBook{book}, nil
		}},
		MailSender: &fakeMailSender{},
		Now:        func() time.Time { return now },
	})
	sender.recordBaseBackoff = time.Millisecond

	if _, err := sender.EnqueueManual(context.Background()); err != nil {
		t.Fatalf("EnqueueManual() error = %v", err)
	}

	sender.Wait()

	if calls := sends.recordCallsList(); calls != 1 {
		t.Fatalf("RecordBookAccepted calls = %d, want 1 when send record is missing", calls)
	}

	completed := sends.completedList()
	if len(completed) != 1 || completed[0].status != domain.KindleStatusFailed {
		t.Fatalf("completed sends = %+v, want failed", completed)
	}

	if sender.IsRunning() {
		t.Fatal("IsRunning() = true after missing send receipt failure")
	}
}
