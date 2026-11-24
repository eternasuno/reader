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
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	_ "time/tzdata"

	"reader/internal/content"
	"reader/internal/domain"
	"reader/internal/epub"
	"reader/internal/fetcher"
	httpserver "reader/internal/http"
	"reader/internal/mail"
	"reader/internal/sqlite"
	"reader/internal/worker"
	"reader/web"
)

const (
	defaultAppURL          = "http://localhost:8080"
	defaultPort            = "8080"
	defaultDataDir         = ".data"
	sessionSecretBytes     = 32
	readHeaderTimeout      = 10 * time.Second
	readTimeout            = 30 * time.Second
	foregroundFetchTimeout = 30 * time.Second
	// writeTimeout bounds full handler execution and response writing; 60s stays
	// well above the 30s foreground fetch/extract timeout.
	writeTimeout          = 60 * time.Second
	shutdownTimeout       = 15 * time.Second
	databaseFileName      = "reader.db"
	epubSpoolDirName      = "spool"
	staticAssetsDirectory = "dist"
)

// envConfig is the bootstrap configuration read from environment variables.
// External service settings (Jina key, browser endpoint, Kindle/SMTP
// credentials) live in SQLite and are read dynamically instead.
type envConfig struct {
	AppPassword         string
	AppURL              string
	Port                string
	DataDir             string
	SessionSecret       []byte
	Location            *time.Location
	AllowPrivateNetwork bool
}

type appDependencies struct {
	fetchClient      *fetcher.Client
	feedParser       *content.Parser
	articleExtractor *content.Extractor
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
	// Workers use an application-owned context so a canceled HTTP request can
	// never abort a background job.
	appCtx, cancelApp := context.WithCancel(context.Background())
	defer cancelApp()

	deps := buildAppDependencies(appCtx, cfg, store)
	handler, err := buildAppHandler(cfg, store, deps)
	if err != nil {
		return err
	}

	listener, err := (&net.ListenConfig{}).Listen(ctx, "tcp", ":"+cfg.Port)
	if err != nil {
		return fmt.Errorf("listen %s: %w", ":"+cfg.Port, err)
	}

	stopWorkers := startWorkers(appCtx, cancelApp, deps)

	return serveUntilExit(ctx, listener, handler, stopWorkers)
}

func recoverStartupState(ctx context.Context, store *sqlite.Store, spoolDir string, now time.Time) error {
	// Mark leftover "running" Kindle sends as failed before workers start so a
	// crash cannot leave an in-progress job blocking future deliveries.
	if err := store.KindleSends().RecoverRunningOnStartup(ctx, now); err != nil {
		return fmt.Errorf("recover kindle sends: %w", err)
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

func buildAppDependencies(appCtx context.Context, cfg envConfig, store *sqlite.Store) appDependencies {
	sanitizer := content.NewSanitizer()
	feedParser := content.NewFeedParser(sanitizer)
	articleExtractor := content.NewArticleExtractor(sanitizer)
	settings := store.Settings()
	fetchClient := newFetchClient(cfg.AllowPrivateNetwork, settings)

	return appDependencies{
		fetchClient:      fetchClient,
		feedParser:       feedParser,
		articleExtractor: articleExtractor,
		refreshQueue: worker.NewRefreshQueue(worker.RefreshConfig{
			Feeds:     store.Feeds(),
			FeedItems: store.FeedItems(),
			Settings:  settings,
			Fetcher:   fetchClient,
			Parser:    feedParser,
		}),
		kindleSender: worker.NewKindleSender(worker.KindleConfig{
			BaseCtx:     appCtx,
			KindleSends: store.KindleSends(),
			FeedItems:   store.FeedItems(),
			Fetcher:     fetchClient,
			Extractor:   articleExtractor,
			EPUBBuilder: epub.NewBuilder(epub.Config{
				ImageFetcher: fetchClient,
				SpoolDir:     filepath.Join(cfg.DataDir, epubSpoolDirName),
			}),
			MailSender: mail.NewSender(mail.Config{}),
			Location:   cfg.Location,
		}),
	}
}

func newFetchClient(allowPrivateNetwork bool, settings *sqlite.SettingRepo) *fetcher.Client {
	return fetcher.New(fetcher.Config{
		AllowPrivateNetwork: allowPrivateNetwork,
		Settings: func(ctx context.Context) (fetcher.ExtractorSettings, error) {
			loaded, err := settings.Get(ctx)
			if err != nil {
				return fetcher.ExtractorSettings{}, err
			}

			return fetcher.ExtractorSettings{
				Provider:        loaded.Provider,
				JinaKey:         loaded.JinaKey,
				BrowserEndpoint: loaded.BrowserEndpoint,
			}, nil
		},
	})
}

func buildAppHandler(cfg envConfig, store *sqlite.Store, deps appDependencies) (http.Handler, error) {
	staticFS, err := fs.Sub(web.DistFS, staticAssetsDirectory)
	if err != nil {
		return nil, fmt.Errorf("prepare static assets: %w", err)
	}

	handler, err := httpserver.NewServer(httpserver.Config{
		AppPassword:            cfg.AppPassword,
		AppURL:                 cfg.AppURL,
		SessionSecret:          cfg.SessionSecret,
		Location:               cfg.Location,
		Now:                    time.Now,
		ForegroundFetchTimeout: foregroundFetchTimeout,
		HealthCheck:            func(ctx context.Context) error { return store.ReadDB().PingContext(ctx) },
		StaticFS:               staticFS,
		Folders:                store.Folders(),
		Feeds:                  store.Feeds(),
		FeedItems:              store.FeedItems(),
		SavedPages:             store.SavedPages(),
		Settings:               store.Settings(),
		KindleSends:            store.KindleSends(),
		FeedFetcher:            deps.fetchClient,
		FeedParser:             deps.feedParser,
		WebpageFetcher:         deps.fetchClient,
		ArticleExtractor:       deps.articleExtractor,
		Refresher:              deps.refreshQueue,
		Kindle:                 deps.kindleSender,
	})
	if err != nil {
		return nil, fmt.Errorf("build http server: %w", err)
	}

	return handler, nil
}

type handlerTracker struct {
	mu      sync.Mutex
	closed  bool
	active  sync.WaitGroup
	handler http.Handler
}

func (tracker *handlerTracker) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	tracker.mu.Lock()
	if tracker.closed {
		tracker.mu.Unlock()
		http.Error(w, "server shutting down", http.StatusServiceUnavailable)

		return
	}

	tracker.active.Add(1)
	tracker.mu.Unlock()
	defer tracker.active.Done()
	tracker.handler.ServeHTTP(w, r)
}

func (tracker *handlerTracker) closeAdmission() {
	tracker.mu.Lock()
	tracker.closed = true
	tracker.mu.Unlock()
}

func serveUntilExit(ctx context.Context, listener net.Listener, handler http.Handler, stopWorkers func()) error {
	return serveUntilExitWithTimeout(ctx, listener, handler, stopWorkers, shutdownTimeout)
}

func serveUntilExitWithTimeout(ctx context.Context, listener net.Listener, handler http.Handler, stopWorkers func(), timeout time.Duration) error {
	trackedHandler := &handlerTracker{handler: handler}
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

	shutdownErr := drainHTTPServer(server, timeout, trackedHandler.closeAdmission)
	trackedHandler.active.Wait()
	extractionErr := waitExtractions(handler, timeout)
	if extractionErr != nil {
		slog.Error("extraction shutdown failed", "error", extractionErr)
	}

	shutdownErr = errors.Join(shutdownErr, extractionErr)
	stopWorkers()

	if serveErr != nil {
		return errors.Join(fmt.Errorf("serve http: %w", serveErr), shutdownErr)
	}

	return shutdownErr
}

func waitExtractions(handler http.Handler, timeout time.Duration) error {
	extractor, ok := handler.(interface{ WaitExtractions(context.Context) error })
	if !ok {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	if err := extractor.WaitExtractions(ctx); err != nil {
		return fmt.Errorf("wait for extractions: %w", err)
	}

	return nil
}

func drainHTTPServer(server *http.Server, timeout time.Duration, closeAdmission func()) error {
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), timeout)
	defer cancelShutdown()

	shutdownErr := server.Shutdown(shutdownCtx)
	closeAdmission()
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
	if appPassword == "" {
		return envConfig{}, errors.New("APP_PASSWORD is required")
	}

	if err := httpserver.ValidateAppPassword(appPassword); err != nil {
		return envConfig{}, err
	}

	appURL := envOrDefault(getenv, "APP_URL", defaultAppURL)
	if err := validateAppURL(appURL); err != nil {
		return envConfig{}, err
	}

	sessionSecret, err := loadSessionSecret(getenv)
	if err != nil {
		return envConfig{}, err
	}

	location := time.Local
	if tz := getenv("TZ"); tz != "" {
		loaded, err := time.LoadLocation(tz)
		if err != nil {
			return envConfig{}, fmt.Errorf("load time zone %q: %w", tz, err)
		}

		location = loaded
	}

	return envConfig{
		AppPassword:         appPassword,
		AppURL:              appURL,
		Port:                envOrDefault(getenv, "PORT", defaultPort),
		DataDir:             envOrDefault(getenv, "DATA_DIR", defaultDataDir),
		SessionSecret:       sessionSecret,
		Location:            location,
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

func validateAppURL(rawAppURL string) error {
	appURL, err := url.Parse(strings.TrimSpace(rawAppURL))
	if err != nil || appURL.User != nil || appURL.Host == "" {
		// The raw URL may embed credentials, so never echo it or the parse error.
		return errors.New("invalid APP_URL")
	}

	appOrigin, ok := domain.OriginFromURL(appURL)
	if !ok {
		return errors.New("invalid APP_URL")
	}

	switch appOrigin.Scheme {
	case "http", "https":
		return nil
	default:
		return errors.New("invalid APP_URL")
	}
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
