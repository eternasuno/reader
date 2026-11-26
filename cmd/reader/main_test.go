package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"reader/internal/domain"
	"reader/internal/sqlite"
)

func getenvFrom(values map[string]string) func(string) string {
	return func(key string) string {
		return values[key]
	}
}

func TestLoadConfigDefaults(t *testing.T) {
	tests := []struct {
		name                             string
		env                              map[string]string
		password, url, port, dir, secret string
		private                          bool
	}{
		{name: "defaults", env: map[string]string{"APP_PASSWORD": "secret"}, password: "secret", url: "http://localhost:8080", port: "8080", dir: ".data"},
		{name: "overrides", env: map[string]string{"APP_PASSWORD": "hunter2", "APP_URL": "https://reader.example.com", "PORT": "9000", "DATA_DIR": "/var/lib/reader", "SESSION_SECRET": "fixed-secret-0123456789abcdef01234", "ALLOW_PRIVATE_NETWORK": "TRUE"}, password: "hunter2", url: "https://reader.example.com", port: "9000", dir: "/var/lib/reader", secret: "fixed-secret-0123456789abcdef01234", private: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := loadConfig(getenvFrom(tt.env))
			if err != nil {
				t.Fatalf("load config: %v", err)
			}
			if cfg.AppPassword != tt.password || cfg.AppURL != tt.url || cfg.Port != tt.port || cfg.DataDir != tt.dir || cfg.AllowPrivateNetwork != tt.private {
				t.Fatalf("unexpected config: password, URL, port, directory or private network setting")
			}
			if tt.secret != "" {
				if string(cfg.SessionSecret) != tt.secret {
					t.Fatal("configured session secret changed")
				}
			} else {
				if len(cfg.SessionSecret) != 32 || bytes.Equal(cfg.SessionSecret, make([]byte, 32)) {
					t.Fatal("generated session secret must be 32 nonzero bytes")
				}
				second, err := loadConfig(getenvFrom(tt.env))
				if err != nil {
					t.Fatalf("load second config: %v", err)
				}
				if bytes.Equal(cfg.SessionSecret, second.SessionSecret) {
					t.Fatal("generated session secrets must differ between startups")
				}
			}
		})
	}
}

func TestServeUntilExitDrainsAndStopsWorkers(t *testing.T) {
	listener, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started, release, finished, stopped := make(chan struct{}), make(chan struct{}), make(chan struct{}), make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	handler := noopExtractionHandler{http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		w.WriteHeader(http.StatusOK)
		close(finished)
	})}
	done := make(chan error, 1)
	go func() {
		done <- serveUntilExit(ctx, listener, handler, func() {
			select {
			case <-finished:
			default:
				t.Error("workers stopped before handler completed")
			}
			close(stopped)
		}, shutdownTimeout)
	}()
	responses := make(chan error, 1)
	go func() {
		resp, err := http.Get("http://" + listener.Addr().String() + "/")
		if err == nil {
			if resp.StatusCode != http.StatusOK {
				err = errors.New("unexpected response status")
			}
			_ = resp.Body.Close()
		}
		responses <- err
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("handler did not start")
	}
	cancel()
	select {
	case <-stopped:
		t.Fatal("workers stopped while handler was blocked")
	case <-done:
		t.Fatal("server returned while handler was blocked")
	default:
	}
	releaseOnce.Do(func() { close(release) })
	select {
	case err := <-responses:
		if err != nil {
			t.Fatalf("request: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("request did not finish")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("serveUntilExit: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("server did not stop")
	}
	select {
	case <-finished:
	default:
		t.Fatal("handler did not finish")
	}
	select {
	case <-stopped:
	default:
		t.Fatal("workers did not stop")
	}
}

type noopExtractionHandler struct {
	http.Handler
}

func (noopExtractionHandler) WaitExtractions(context.Context) error {
	return nil
}

type extractionWaitHandler struct {
	entered chan struct{}
	release chan struct{}
}

func (h *extractionWaitHandler) ServeHTTP(http.ResponseWriter, *http.Request) {}

func (h *extractionWaitHandler) WaitExtractions(ctx context.Context) error {
	close(h.entered)
	select {
	case <-h.release:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func TestServeUntilExitWaitsForExtractionsBeforeWorkers(t *testing.T) {
	listener, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	handler := &extractionWaitHandler{entered: make(chan struct{}), release: make(chan struct{})}
	stopped := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- serveUntilExit(ctx, listener, handler, func() { close(stopped) }, shutdownTimeout)
	}()
	cancel()
	<-handler.entered
	select {
	case <-stopped:
		t.Fatal("workers stopped before extractions finished")
	default:
	}

	close(handler.release)
	if err := <-done; err != nil {
		t.Fatalf("serveUntilExit: %v", err)
	}

	select {
	case <-stopped:
	default:
		t.Fatal("workers did not stop")
	}
}

func TestServeUntilExitWaitsForForcedHandler(t *testing.T) {
	listener, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	started := make(chan struct{})
	canceled := make(chan struct{})
	release := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })

	stopped := make(chan struct{})
	done := make(chan error, 1)
	handler := noopExtractionHandler{http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(canceled)
		<-release
	})}
	go func() {
		done <- serveUntilExit(ctx, listener, handler, func() { close(stopped) }, 1200*time.Millisecond)
	}()

	startShutdownTestRequest(t, listener.Addr().String(), started)

	cancel()
	select {
	case <-canceled:
	case <-time.After(5 * time.Second):
		t.Fatal("forced close did not cancel request")
	}

	select {
	case <-stopped:
		t.Fatal("workers stopped before handler completed")
	case <-done:
		t.Fatal("server returned before handler completed")
	default:
	}

	releaseOnce.Do(func() { close(release) })

	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) || errors.Is(err, errHandlersStillRunning) {
			t.Fatalf("serveUntilExit error = %v, want deadline exceeded without handler timeout", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("server did not stop after handler completed")
	}

	select {
	case <-stopped:
	default:
		t.Fatal("workers did not stop")
	}
}

func TestServeUntilExitTimesOutWithBlockedHandler(t *testing.T) {
	listener, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	started := make(chan struct{})
	release := make(chan struct{})
	handlerDone := make(chan struct{})
	t.Cleanup(func() {
		close(release)
		waitForChannelCleanup(t, started, handlerDone, "handler")
	})

	const timeout = 150 * time.Millisecond
	stopped := make(chan struct{})
	done := make(chan error, 1)
	handler := noopExtractionHandler{http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(handlerDone)
		close(started)
		<-release
	})}
	go func() {
		done <- serveUntilExit(ctx, listener, handler, func() { close(stopped) }, timeout)
	}()

	startShutdownTestRequest(t, listener.Addr().String(), started)

	start := time.Now()
	cancel()

	select {
	case err := <-done:
		if elapsed := time.Since(start); elapsed >= 3*timeout {
			t.Fatalf("shutdown took %v, want < %v (3x timeout)", elapsed, 3*timeout)
		}

		if !errors.Is(err, errHandlersStillRunning) || !errors.Is(err, context.DeadlineExceeded) || errors.Is(err, errShutdownDeadline) {
			t.Fatalf("serveUntilExit error = %v, want handler timeout without worker deadline", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("serveUntilExit did not return within timeout")
	}

	select {
	case <-stopped:
	default:
		t.Fatal("workers did not stop")
	}
}

type blockedShutdownHandler struct {
	handlerStarted chan struct{}
	releaseHandler chan struct{}
	handlerDone    chan struct{}
	extractEntered chan struct{}
	releaseExtract chan struct{}
}

func (h *blockedShutdownHandler) ServeHTTP(http.ResponseWriter, *http.Request) {
	defer close(h.handlerDone)
	close(h.handlerStarted)
	<-h.releaseHandler
}

func (h *blockedShutdownHandler) WaitExtractions(ctx context.Context) error {
	close(h.extractEntered)
	select {
	case <-h.releaseExtract:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("blocked extractions: %w", ctx.Err())
	}
}

func TestServeUntilExitEnforcesSingleDeadlineAcrossAllBlockedStages(t *testing.T) {
	t.Parallel()

	listener, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	handler := &blockedShutdownHandler{
		handlerStarted: make(chan struct{}),
		releaseHandler: make(chan struct{}),
		handlerDone:    make(chan struct{}),
		extractEntered: make(chan struct{}),
		releaseExtract: make(chan struct{}),
	}
	workerStarted := make(chan struct{})
	releaseWorkers := make(chan struct{})
	workerDone := make(chan struct{})
	t.Cleanup(func() {
		close(handler.releaseHandler)
		close(handler.releaseExtract)
		close(releaseWorkers)
		waitForChannelCleanup(t, handler.handlerStarted, handler.handlerDone, "handler")
		waitForChannelCleanup(t, workerStarted, workerDone, "workers")
	})

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	const timeout = 240 * time.Millisecond
	done := make(chan error, 1)
	go func() {
		done <- serveUntilExit(ctx, listener, handler, func() {
			defer close(workerDone)
			close(workerStarted)
			<-releaseWorkers
		}, timeout)
	}()

	startShutdownTestRequest(t, listener.Addr().String(), handler.handlerStarted)

	start := time.Now()
	cancel()

	var shutdownErr error
	select {
	case shutdownErr = <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("serveUntilExit did not return within single deadline")
	}

	if elapsed := time.Since(start); elapsed >= 3*timeout {
		t.Fatalf("shutdown took %v, want < %v (3x timeout)", elapsed, 3*timeout)
	}

	assertAllStageErrors(t, shutdownErr, handler.extractEntered, workerStarted)
}

func startShutdownTestRequest(t *testing.T, addr string, started <-chan struct{}) {
	t.Helper()

	reqCtx, cancelReq := context.WithCancel(context.Background())
	t.Cleanup(cancelReq)

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, "http://"+addr+"/", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}

	go func() {
		resp, err := (&http.Client{}).Do(req)
		if err == nil {
			_ = resp.Body.Close()
		}
	}()

	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("handler did not start")
	}
}

func waitForChannelCleanup(t *testing.T, started <-chan struct{}, done <-chan struct{}, name string) {
	t.Helper()

	select {
	case <-started:
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Errorf("blocked %s did not exit after release", name)
		}
	default:
	}
}

func assertAllStageErrors(t *testing.T, err error, extractEntered <-chan struct{}, workerStarted <-chan struct{}) {
	t.Helper()

	for _, target := range []error{errHandlersStillRunning, errShutdownDeadline, context.DeadlineExceeded} {
		if !errors.Is(err, target) {
			t.Fatalf("shutdown error = %v, want errors.Is(_, %v)", err, target)
		}
	}

	select {
	case <-extractEntered:
	default:
		t.Fatal("WaitExtractions was not entered")
	}

	select {
	case <-workerStarted:
	default:
		t.Fatal("stopWorkers was not started")
	}
}

func TestLoadConfigAllowPrivateNetworkValues(t *testing.T) {
	cases := map[string]bool{
		"true":  true,
		"True":  true,
		"1":     true,
		"false": false,
		"0":     false,
		"yes":   false,
		"":      false,
	}

	for value, want := range cases {
		t.Run(value, func(t *testing.T) {
			cfg, err := loadConfig(getenvFrom(map[string]string{
				"APP_PASSWORD":          "secret",
				"ALLOW_PRIVATE_NETWORK": value,
			}))
			if err != nil {
				t.Fatalf("load config: %v", err)
			}

			if cfg.AllowPrivateNetwork != want {
				t.Fatalf("allow private network = %v, want %v", cfg.AllowPrivateNetwork, want)
			}
		})
	}
}

func TestLoadConfigValidationErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		env  map[string]string
		leak string
	}{
		{name: "missing password", env: map[string]string{}},
		{name: "invalid password", env: map[string]string{"APP_PASSWORD": strings.Repeat("a", 5000)}, leak: strings.Repeat("a", 5000)},
		{name: "invalid app url", env: map[string]string{"APP_PASSWORD": "secret", "APP_URL": "https://user:topsecret@reader.example.com"}, leak: "topsecret"},
		{name: "short session secret", env: map[string]string{"APP_PASSWORD": "secret", "SESSION_SECRET": "too-short-secret-value"}, leak: "too-short-secret-value"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			_, err := loadConfig(getenvFrom(tt.env))
			if err == nil {
				t.Fatalf("loadConfig(%s) succeeded, want error", tt.name)
			}

			if tt.leak != "" && strings.Contains(err.Error(), tt.leak) {
				t.Fatalf("error leaked secret/credential value: %v", err)
			}
		})
	}
}

func TestRecoverStartupStateCleansSpoolAndRecoversRunningWork(t *testing.T) {
	t.Parallel()

	ctx := context.Background()
	dataDir := t.TempDir()
	store, err := sqlite.Open(ctx, filepath.Join(dataDir, databaseFileName))
	if err != nil {
		t.Fatalf("sqlite.Open() error = %v", err)
	}
	defer func() { _ = store.Close() }()

	if err := store.Settings().UpdateSMTP(ctx, domain.SMTPSettings{
		SenderEmail: "sender@example.com",
		Host:        "smtp.example.com",
		Port:        587,
		Security:    domain.SMTPSecuritySTARTTLS,
	}); err != nil {
		t.Fatalf("UpdateSMTP() error = %v", err)
	}

	startedAt := time.Date(2026, 3, 15, 8, 0, 0, 0, time.UTC)
	if err := store.Settings().UpdateKindle(ctx, domain.KindleSettings{KindleEmail: "reader@kindle.com"}, startedAt); err != nil {
		t.Fatalf("UpdateKindle() error = %v", err)
	}
	if _, err := store.KindleSends().ClaimManualSend(ctx, domain.NewID(), startedAt); err != nil {
		t.Fatalf("ClaimManualSend() error = %v", err)
	}

	feedURL, err := domain.ParseNormalizedURL("https://feeds.example.com/rss", domain.ErrFeedUrlInvalid)
	if err != nil {
		t.Fatalf("ParseNormalizedURL() error = %v", err)
	}

	feed, err := store.Feeds().Create(ctx, domain.Feed{
		ID:         domain.NewID(),
		URL:        feedURL,
		Title:      "Example",
		ReaderMode: domain.ReaderModeDefault,
		Order:      domain.SortOrderNewest,
	}, startedAt)
	if err != nil {
		t.Fatalf("Feeds().Create() error = %v", err)
	}

	if claimed, err := store.Feeds().ClaimDueRefresh(ctx, domain.NewID(), startedAt); err != nil || claimed == nil || claimed.ID != feed.ID {
		t.Fatalf("ClaimDueRefresh() = %+v, %v; want the new feed claimed as running", claimed, err)
	}

	spoolDir := filepath.Join(dataDir, epubSpoolDirName)
	if err := os.MkdirAll(spoolDir, 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}

	if err := os.WriteFile(filepath.Join(spoolDir, "lantern-epub-crashed.spool"), []byte("leftover"), 0o600); err != nil {
		t.Fatalf("WriteFile() error = %v", err)
	}

	if err := recoverStartupState(ctx, store, spoolDir, startedAt.Add(time.Minute)); err != nil {
		t.Fatalf("recoverStartupState() error = %v", err)
	}

	recent, err := store.KindleSends().ListRecent(ctx)
	if err != nil {
		t.Fatalf("ListRecent() error = %v", err)
	}
	if len(recent) != 1 || recent[0].Status != domain.KindleStatusFailed {
		t.Fatalf("recent sends after recovery = %+v, want 1 failed row", recent)
	}

	// The interrupted attempt no longer blocks the feed, which is still due.
	if claimed, err := store.Feeds().ClaimDueRefresh(ctx, domain.NewID(), startedAt.Add(time.Minute)); err != nil || claimed == nil || claimed.ID != feed.ID {
		t.Fatalf("ClaimDueRefresh() after recovery = %+v, %v; want the interrupted feed claimable again", claimed, err)
	}

	info, err := os.Stat(spoolDir)
	if err != nil {
		t.Fatalf("Stat(spoolDir) error = %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0o700 {
		t.Fatalf("spoolDir mode = %o, want 0700", perm)
	}

	entries, err := os.ReadDir(spoolDir)
	if err != nil {
		t.Fatalf("ReadDir(spoolDir) error = %v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("leftover spool files after startup recovery: %v", entries)
	}
}

func TestFatalExitError(t *testing.T) {
	t.Parallel()

	fatalErr := errors.New("fatal terminal status error")
	shutdownErr := errors.New("shutdown failed")

	t.Run("normal shutdown without fatal cause", func(t *testing.T) {
		parentCtx, cancelParent := context.WithCancel(context.Background())
		runCtx, cancelRun := context.WithCancelCause(parentCtx)
		defer cancelRun(nil)

		cancelParent()
		if got := fatalExitError(runCtx, nil); got != nil {
			t.Fatalf("fatalExitError() = %v, want nil", got)
		}

		if got := fatalExitError(runCtx, shutdownErr); !errors.Is(got, shutdownErr) {
			t.Fatalf("fatalExitError() = %v, want %v", got, shutdownErr)
		}
	})

	t.Run("fatal cause joined with shutdown error even if parent cancels later", func(t *testing.T) {
		parentCtx, cancelParent := context.WithCancel(context.Background())
		runCtx, cancelRun := context.WithCancelCause(parentCtx)
		defer cancelRun(nil)

		cancelRun(fatalErr)
		cancelParent()

		got := fatalExitError(runCtx, shutdownErr)
		if !errors.Is(got, fatalErr) || !errors.Is(got, shutdownErr) {
			t.Fatalf("fatalExitError() = %v, want both %v and %v", got, fatalErr, shutdownErr)
		}
	})
}
