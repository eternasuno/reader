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
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
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
	defaultAppURL         = "http://localhost:8080"
	defaultPort           = "8080"
	defaultDataDir        = ".data"
	sessionSecretBytes    = 32
	readHeaderTimeout     = 10 * time.Second
	readTimeout           = 30 * time.Second
	shutdownTimeout       = 15 * time.Second
	databaseFileName      = "reader.db"
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

	store, err := sqlite.Open(ctx, filepath.Join(cfg.DataDir, databaseFileName))
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}
	defer func() {
		if closeErr := store.Close(); closeErr != nil && err == nil {
			err = fmt.Errorf("close database: %w", closeErr)
		}
	}()

	// Mark leftover "running" Kindle sends as failed before workers start so a
	// crash cannot leave an in-progress job blocking future deliveries.
	if err := store.KindleSends().RecoverRunningOnStartup(ctx, time.Now().UTC()); err != nil {
		return fmt.Errorf("recover kindle sends: %w", err)
	}

	sanitizer := content.NewSanitizer()
	feedParser := content.NewFeedParser(sanitizer)
	articleExtractor := content.NewArticleExtractor(sanitizer)
	fetchClient := fetcher.New(fetcher.Config{AllowPrivateNetwork: cfg.AllowPrivateNetwork, Settings: store.Settings()})

	// Workers use an application-owned context so a canceled HTTP request can
	// never abort a background job.
	appCtx, cancelApp := context.WithCancel(context.Background())
	defer cancelApp()

	refreshQueue, kindleSender := startWorkers(appCtx, cfg.Location, store, fetchClient, feedParser, articleExtractor)
	handler, err := buildAppHandler(cfg, store, fetchClient, feedParser, articleExtractor, refreshQueue, kindleSender)
	if err != nil {
		return err
	}

	return serveUntilSignal(ctx, ":"+cfg.Port, handler, cancelApp, kindleSender)
}

func startWorkers(appCtx context.Context, loc *time.Location, store *sqlite.Store, fetchClient *fetcher.Client, feedParser *content.Parser, articleExtractor *content.Extractor) (*worker.RefreshQueue, *worker.KindleSender) {
	refreshQueue := worker.NewRefreshQueue(worker.RefreshConfig{
		Feeds:     store.Feeds(),
		FeedItems: store.FeedItems(),
		Settings:  store.Settings(),
		Fetcher:   fetchClient,
		Parser:    feedParser,
	})

	kindleSender := worker.NewKindleSender(worker.KindleConfig{
		BaseCtx:     appCtx,
		Settings:    store.Settings(),
		KindleSends: store.KindleSends(),
		FeedItems:   store.FeedItems(),
		Fetcher:     fetchClient,
		Extractor:   articleExtractor,
		EPUBBuilder: epub.NewBuilder(epub.Config{ImageFetcher: fetchClient}),
		MailSender:  mail.NewSender(mail.Config{}),
		Location:    loc,
	})

	refreshQueue.Start(appCtx)
	go kindleSender.StartScheduler(appCtx)

	return refreshQueue, kindleSender
}

func buildAppHandler(cfg envConfig, store *sqlite.Store, fetchClient *fetcher.Client, feedParser *content.Parser, articleExtractor *content.Extractor, refreshQueue *worker.RefreshQueue, kindleSender *worker.KindleSender) (http.Handler, error) {
	staticFS, err := fs.Sub(web.DistFS, staticAssetsDirectory)
	if err != nil {
		return nil, fmt.Errorf("prepare static assets: %w", err)
	}

	handler, err := httpserver.NewServer(httpserver.Config{
		AppPassword:      cfg.AppPassword,
		AppURL:           cfg.AppURL,
		SessionSecret:    cfg.SessionSecret,
		Location:         cfg.Location,
		Now:              time.Now,
		HealthCheck:      func(ctx context.Context) error { return store.ReadDB().PingContext(ctx) },
		StaticFS:         staticFS,
		Folders:          store.Folders(),
		Feeds:            store.Feeds(),
		FeedItems:        store.FeedItems(),
		SavedPages:       store.SavedPages(),
		Settings:         store.Settings(),
		KindleSends:      store.KindleSends(),
		FeedFetcher:      fetchClient,
		FeedParser:       feedParser,
		WebpageFetcher:   fetchClient,
		ArticleExtractor: articleExtractor,
		Refresher:        refreshQueue,
		Kindle:           kindleSender,
	})
	if err != nil {
		return nil, fmt.Errorf("build http server: %w", err)
	}

	return handler, nil
}

func serveUntilSignal(ctx context.Context, addr string, handler http.Handler, cancelApp context.CancelFunc, kindleSender *worker.KindleSender) error {
	server := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: readHeaderTimeout, ReadTimeout: readTimeout}
	serveErrs := make(chan error, 1)

	go func() {
		slog.Info("reader listening", "addr", server.Addr)
		serveErrs <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		slog.Info("reader shutting down")

		shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancelShutdown()

		shutdownErr := server.Shutdown(shutdownCtx)
		cancelApp()
		kindleSender.Wait()

		if shutdownErr != nil {
			return fmt.Errorf("shutdown http server: %w", shutdownErr)
		}

		return nil
	case serveErr := <-serveErrs:
		if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			return fmt.Errorf("serve http: %w", serveErr)
		}

		return nil
	}
}

// loadConfig reads the bootstrap environment variables, applying the defaults
// documented in README.md and generating a per-startup session secret when none
// is configured.
func loadConfig(getenv func(string) string) (envConfig, error) {
	appPassword := getenv("APP_PASSWORD")
	if appPassword == "" {
		return envConfig{}, errors.New("APP_PASSWORD is required")
	}

	sessionSecret := []byte(getenv("SESSION_SECRET"))
	if len(sessionSecret) == 0 {
		generated := make([]byte, sessionSecretBytes)
		if _, err := rand.Read(generated); err != nil {
			return envConfig{}, fmt.Errorf("generate session secret: %w", err)
		}

		sessionSecret = generated
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
		AppURL:              envOrDefault(getenv, "APP_URL", defaultAppURL),
		Port:                envOrDefault(getenv, "PORT", defaultPort),
		DataDir:             envOrDefault(getenv, "DATA_DIR", defaultDataDir),
		SessionSecret:       sessionSecret,
		Location:            location,
		AllowPrivateNetwork: isTruthy(getenv("ALLOW_PRIVATE_NETWORK")),
	}, nil
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
