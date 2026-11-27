// Command reader starts the single-user reader: it opens SQLite, recovers
// interrupted Kindle sends, starts the background workers, and serves the API
// and embedded SPA until SIGINT/SIGTERM.
package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	_ "time/tzdata"

	"reader/internal/content"
	"reader/internal/epub"
	"reader/internal/fetcher"
	httpserver "reader/internal/http"
	"reader/internal/mail"
	"reader/internal/sqlite"
	"reader/internal/worker"
	"reader/web"
)

const (
	defaultAppURL      = "http://localhost:8080"
	defaultPort        = "8080"
	defaultDataDir     = ".data"
	sessionSecretBytes = 32
	readHeaderTimeout  = 10 * time.Second
	readTimeout        = 30 * time.Second
	// writeTimeout bounds full handler execution and response writing; 60s stays
	// above the 55s foreground fetch/extract timeout.
	writeTimeout          = 60 * time.Second
	shutdownTimeout       = 3 * time.Second
	databaseFileName      = "reader.db"
	epubSpoolDirName      = "spool"
	staticAssetsDirectory = "dist"
)

// envConfig is the bootstrap configuration read from environment variables.
// External service settings (Browserless URL/token, Kindle/SMTP credentials)
// live in SQLite and are read dynamically instead.
type envConfig struct {
	AppPassword         string
	AppURL              string
	Port                string
	DataDir             string
	SessionSecret       []byte
	AllowPrivateNetwork bool
}

type appDependencies struct {
	fetchClient      *fetcher.Client
	feedParser       *content.Parser
	webpageExtractor *content.WebpageExtractor
	refreshQueue     *worker.RefreshQueue
	kindleSender     *worker.KindleSender
}

func main() {
	if err := run(); err != nil {
		slog.Error("reader exited", "error", err)

		os.Exit(1)
	}
}

func run() (err error) {
	cfg, err := loadConfig(os.Getenv)
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	lockFile, err := acquireDataDirLock(cfg.DataDir)
	if err != nil {
		return err
	}

	defer func() {
		if closeErr := lockFile.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("close data directory lock: %w", closeErr)
		}
	}()

	store, err := sqlite.Open(ctx, filepath.Join(cfg.DataDir, databaseFileName))
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}

	defer func() {
		if closeErr := store.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("close database: %w", closeErr)
		}
	}()

	spoolDir := filepath.Join(cfg.DataDir, epubSpoolDirName)
	if err := recoverStartupState(ctx, store, spoolDir, time.Now().UTC()); err != nil {
		return err
	}

	return serveApp(ctx, cfg, store)
}

func serveApp(ctx context.Context, cfg envConfig, store *sqlite.Store) error {
	runCtx, cancelRun := context.WithCancelCause(ctx)
	defer cancelRun(nil)

	// Workers use an application-owned context so a canceled HTTP request can
	// never abort a background job.
	appCtx, cancelApp := context.WithCancel(context.Background())
	defer cancelApp()

	deps := buildAppDependencies(appCtx, cfg, store, func(err error) {
		slog.Error("fatal error; shutting down", "error", err)
		cancelRun(err)
	})
	handler, err := buildAppHandler(cfg, store, deps)
	if err != nil {
		return err
	}

	listener, err := (&net.ListenConfig{}).Listen(runCtx, "tcp", ":"+cfg.Port)
	if err != nil {
		return fmt.Errorf("listen %s: %w", ":"+cfg.Port, err)
	}

	stopWorkers := startWorkers(appCtx, cancelApp, deps)
	shutdownErr := serveUntilExit(runCtx, listener, handler, stopWorkers, shutdownTimeout)

	return fatalExitError(runCtx, shutdownErr)
}

func fatalExitError(runCtx context.Context, shutdownErr error) error {
	if cause := context.Cause(runCtx); cause != nil && !errors.Is(cause, context.Canceled) {
		return errors.Join(cause, shutdownErr)
	}

	return shutdownErr
}

func recoverStartupState(ctx context.Context, store *sqlite.Store, spoolDir string, now time.Time) error {
	// Mark leftover "running" Kindle sends as failed before workers start so a
	// crash cannot leave an in-progress job blocking future deliveries.
	if err := store.KindleSends().RecoverRunningOnStartup(ctx, now); err != nil {
		return fmt.Errorf("recover kindle sends: %w", err)
	}

	// Likewise for feed refreshes: a leftover running attempt would keep its
	// feed from ever being claimed again.
	if err := store.Feeds().RecoverRunningRefreshes(ctx, now); err != nil {
		return fmt.Errorf("recover feed refreshes: %w", err)
	}

	if err := epub.PrepareSpoolDir(spoolDir); err != nil {
		return fmt.Errorf("prepare epub spool: %w", err)
	}

	return nil
}

func startWorkers(appCtx context.Context, cancelApp context.CancelFunc, deps appDependencies) func() {
	var schedulerWG sync.WaitGroup
	deps.refreshQueue.Start(appCtx)
	schedulerWG.Add(1)
	go func() {
		defer schedulerWG.Done()
		deps.kindleSender.StartScheduler(appCtx)
	}()

	return func() {
		cancelApp()
		deps.refreshQueue.Wait()
		schedulerWG.Wait()
		deps.kindleSender.Wait()
	}
}

func buildAppDependencies(appCtx context.Context, cfg envConfig, store *sqlite.Store, onFatal func(error)) appDependencies {
	sanitizer := content.NewSanitizer()
	feedParser := content.NewFeedParser(sanitizer)
	settings := store.Settings()
	fetchClient := fetcher.New(fetcher.Config{AllowPrivateNetwork: cfg.AllowPrivateNetwork})
	webpageExtractor := content.NewWebpageExtractor(fetchClient, content.NewArticleExtractor(sanitizer), settings)

	return appDependencies{
		fetchClient:      fetchClient,
		feedParser:       feedParser,
		webpageExtractor: webpageExtractor,
		refreshQueue: worker.NewRefreshQueue(worker.RefreshConfig{
			Feeds:     store.Feeds(),
			FeedItems: store.FeedItems(),
			Settings:  settings,
			Fetcher:   fetchClient,
			Parser:    feedParser,
			OnFatal:   onFatal,
		}),
		kindleSender: worker.NewKindleSender(worker.KindleConfig{
			BaseCtx:          appCtx,
			KindleSends:      store.KindleSends(),
			FeedItems:        store.FeedItems(),
			WebpageExtractor: webpageExtractor,
			EPUBBuilder: epub.NewBuilder(epub.Config{
				ImageFetcher: fetchClient,
				SpoolDir:     filepath.Join(cfg.DataDir, epubSpoolDirName),
			}),
			MailSender: mail.NewSender(mail.Config{}),
			OnFatal:    onFatal,
		}),
	}
}

func buildAppHandler(cfg envConfig, store *sqlite.Store, deps appDependencies) (*httpserver.Server, error) {
	staticFS, err := fs.Sub(web.DistFS, staticAssetsDirectory)
	if err != nil {
		return nil, fmt.Errorf("prepare static assets: %w", err)
	}

	handler, err := httpserver.NewServer(httpserver.Config{
		AppPassword:      cfg.AppPassword,
		AppURL:           cfg.AppURL,
		SessionSecret:    cfg.SessionSecret,
		Now:              time.Now,
		HealthCheck:      func(ctx context.Context) error { return store.ReadDB().PingContext(ctx) },
		StaticFS:         staticFS,
		Folders:          store.Folders(),
		Feeds:            store.Feeds(),
		FeedItems:        store.FeedItems(),
		SavedPages:       store.SavedPages(),
		Settings:         store.Settings(),
		KindleSends:      store.KindleSends(),
		FeedFetcher:      deps.fetchClient,
		FeedParser:       deps.feedParser,
		WebpageExtractor: deps.webpageExtractor,
		Refresher:        deps.refreshQueue,
		Kindle:           deps.kindleSender,
	})
	if err != nil {
		return nil, fmt.Errorf("build http server: %w", err)
	}

	return handler, nil
}

type handlerTracker struct {
	mu      sync.Mutex
	closed  bool
	active  int
	drained chan struct{}
	handler http.Handler
}

var (
	errHandlersStillRunning = errors.New("http handlers still running after shutdown timeout")
	errShutdownDeadline     = errors.New("shutdown deadline exceeded")
)

func (tracker *handlerTracker) finish() {
	tracker.mu.Lock()
	defer tracker.mu.Unlock()

	tracker.active--
	if tracker.closed && tracker.active == 0 {
		close(tracker.drained)
	}
}

func (tracker *handlerTracker) wait(ctx context.Context) error {
	select {
	case <-tracker.drained:
		return nil
	default:
	}

	select {
	case <-tracker.drained:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("%w: %w", errHandlersStillRunning, ctx.Err())
	}
}

func (tracker *handlerTracker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	tracker.mu.Lock()
	if tracker.closed {
		tracker.mu.Unlock()
		http.Error(w, "server shutting down", http.StatusServiceUnavailable)

		return
	}

	tracker.active++
	tracker.mu.Unlock()
	defer tracker.finish()
	tracker.handler.ServeHTTP(w, r)
}

func (tracker *handlerTracker) closeAdmission() {
	tracker.mu.Lock()
	if !tracker.closed {
		tracker.closed = true
		if tracker.active == 0 {
			close(tracker.drained)
		}
	}

	tracker.mu.Unlock()
}

type shutdownHandler interface {
	http.Handler
	WaitExtractions(context.Context) error
}

func serveUntilExit(ctx context.Context, listener net.Listener, handler shutdownHandler, stopWorkers func(), timeout time.Duration) error {
	trackedHandler := &handlerTracker{handler: handler, drained: make(chan struct{})}
	server := &http.Server{
		Addr:              listener.Addr().String(),
		Handler:           trackedHandler,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
	}
	serveErrs := make(chan error, 1)

	go func() {
		slog.Info("reader listening", "addr", server.Addr)
		serveErrs <- server.Serve(listener)
	}()

	var serveErr error
	select {
	case <-ctx.Done():
		slog.Info("reader shutting down")
	case serveErr = <-serveErrs:
		if errors.Is(serveErr, http.ErrServerClosed) {
			serveErr = nil
		}
	}

	shutdownErr := shutdownAll(server, trackedHandler, handler, stopWorkers, timeout)
	if serveErr != nil {
		return errors.Join(fmt.Errorf("serve http: %w", serveErr), shutdownErr)
	}

	return shutdownErr
}

func shutdownAll(server *http.Server, tracker *handlerTracker, handler shutdownHandler, stopWorkers func(), timeout time.Duration) error {
	start := time.Now()
	rootCtx, cancelRoot := context.WithDeadline(context.Background(), start.Add(timeout))
	defer cancelRoot()

	httpCtx, cancelHTTP := context.WithDeadline(rootCtx, start.Add(timeout/2))
	defer cancelHTTP()

	shutdownErr := drainHTTPServer(httpCtx, server)
	tracker.closeAdmission()

	handlerCtx, cancelHandler := context.WithDeadline(rootCtx, start.Add(timeout*2/3))
	defer cancelHandler()

	handlerErr := tracker.wait(handlerCtx)
	if handlerErr != nil {
		slog.Error("http handler shutdown failed", "error", handlerErr)
	}

	extractCtx, cancelExtract := context.WithDeadline(rootCtx, start.Add(timeout*5/6))
	defer cancelExtract()

	extractionErr := handler.WaitExtractions(extractCtx)
	if extractionErr != nil {
		extractionErr = fmt.Errorf("wait for extractions: %w", extractionErr)
		slog.Error("extraction shutdown failed", "error", extractionErr)
	}

	workerErr := stopWorkersWithContext(rootCtx, stopWorkers)
	if workerErr != nil {
		slog.Error("worker shutdown failed", "error", workerErr)
	}

	return errors.Join(shutdownErr, handlerErr, extractionErr, workerErr)
}

func stopWorkersWithContext(ctx context.Context, stopWorkers func()) error {
	done := make(chan struct{})
	go func() {
		defer close(done)
		stopWorkers()
	}()

	select {
	case <-done:
		return nil
	default:
	}

	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("stop workers: %w: %w", errShutdownDeadline, ctx.Err())
	}
}

func drainHTTPServer(ctx context.Context, server *http.Server) error {
	shutdownErr := server.Shutdown(ctx)
	if shutdownErr == nil {
		return nil
	}

	if closeErr := server.Close(); closeErr != nil && !errors.Is(closeErr, http.ErrServerClosed) {
		return fmt.Errorf("shutdown http server: %w", errors.Join(shutdownErr, closeErr))
	}

	return fmt.Errorf("shutdown http server: %w", shutdownErr)
}

// loadConfig reads the bootstrap environment variables, applying the defaults
// documented in README.md and generating a per-startup session secret when none
// is configured.
func loadConfig(getenv func(string) string) (envConfig, error) {
	appPassword := getenv("APP_PASSWORD")
	if err := httpserver.ValidateAppPassword(appPassword); err != nil {
		return envConfig{}, err
	}

	appURL := envOrDefault(getenv, "APP_URL", defaultAppURL)
	if err := httpserver.ValidateAppURL(appURL); err != nil {
		return envConfig{}, err
	}

	sessionSecret, err := loadSessionSecret(getenv)
	if err != nil {
		return envConfig{}, err
	}

	return envConfig{
		AppPassword:         appPassword,
		AppURL:              appURL,
		Port:                envOrDefault(getenv, "PORT", defaultPort),
		DataDir:             envOrDefault(getenv, "DATA_DIR", defaultDataDir),
		SessionSecret:       sessionSecret,
		AllowPrivateNetwork: isTruthy(getenv("ALLOW_PRIVATE_NETWORK")),
	}, nil
}

func loadSessionSecret(getenv func(string) string) ([]byte, error) {
	sessionSecret := []byte(getenv("SESSION_SECRET"))
	switch {
	case len(sessionSecret) == 0:
		sessionSecret = make([]byte, sessionSecretBytes)
		if _, err := rand.Read(sessionSecret); err != nil {
			return nil, fmt.Errorf("generate session secret: %w", err)
		}
	case len(sessionSecret) < sessionSecretBytes:
		return nil, fmt.Errorf("SESSION_SECRET must be at least %d bytes", sessionSecretBytes)
	}

	return sessionSecret, nil
}

func envOrDefault(getenv func(string) string, key string, fallback string) string {
	if value := getenv(key); value != "" {
		return value
	}

	return fallback
}

func isTruthy(value string) bool {
	return strings.EqualFold(value, "true") || value == "1"
}
