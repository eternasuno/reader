package main

import (
	"bytes"
	"context"
	"errors"
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
		name                                       string
		env                                        map[string]string
		password, url, port, dir, secret, location string
		private                                    bool
	}{
		{name: "defaults", env: map[string]string{"APP_PASSWORD": "secret"}, password: "secret", url: "http://localhost:8080", port: "8080", dir: ".data"},
		{name: "overrides", env: map[string]string{"APP_PASSWORD": "hunter2", "APP_URL": "https://reader.example.com", "PORT": "9000", "DATA_DIR": "/var/lib/reader", "SESSION_SECRET": "fixed-secret-0123456789abcdef01234", "TZ": "Asia/Shanghai", "ALLOW_PRIVATE_NETWORK": "TRUE"}, password: "hunter2", url: "https://reader.example.com", port: "9000", dir: "/var/lib/reader", secret: "fixed-secret-0123456789abcdef01234", location: "Asia/Shanghai", private: true},
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
			if tt.location == "" {
				if cfg.Location != time.Local {
					t.Fatalf("location = %v, want time.Local", cfg.Location)
				}
			} else if cfg.Location == nil || cfg.Location.String() != tt.location {
				t.Fatalf("location = %v, want %s", cfg.Location, tt.location)
			}
		})
	}
}

func TestLoadConfigChecksPasswordAgainstLoginBodyBudget(t *testing.T) {
	// The login endpoint accepts a 4096 byte JSON body: {"password":"<escaped>"}
	// has a 15 byte envelope, and JSON escaping makes some characters longer.
	const (
		bodyBudget = 4 << 10
		envelope   = len(`{"password":""}`)
	)

	tests := []struct {
		name     string
		password string
		wantOK   bool
	}{
		{name: "missing password", password: "", wantOK: false},
		{name: "ascii at the budget", password: strings.Repeat("a", bodyBudget-envelope), wantOK: true},
		{name: "ascii one byte over", password: strings.Repeat("a", bodyBudget-envelope+1), wantOK: false},
		{name: "quotes at the budget", password: strings.Repeat(`"`, (bodyBudget-envelope)/2), wantOK: true},
		{name: "quotes over while shorter than the ascii limit", password: strings.Repeat(`"`, (bodyBudget-envelope)/2+1), wantOK: false},
		{name: "backslashes at the budget", password: strings.Repeat(`\`, (bodyBudget-envelope)/2), wantOK: true},
		{name: "tabs over while shorter than the ascii limit", password: strings.Repeat("\t", (bodyBudget-envelope)/2+1), wantOK: false},
		{name: "html characters at the budget", password: strings.Repeat("<", bodyBudget-envelope), wantOK: true},
		{name: "html characters one byte over", password: strings.Repeat("<", bodyBudget-envelope+1), wantOK: false},
		{name: "control characters over", password: strings.Repeat("\x01", (bodyBudget-envelope)/6+1), wantOK: false},
		{name: "multibyte characters stay raw", password: strings.Repeat("日", (bodyBudget-envelope)/3), wantOK: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := loadConfig(getenvFrom(map[string]string{"APP_PASSWORD": tt.password}))
			if tt.wantOK {
				if err != nil {
					t.Fatalf("load config: %v", err)
				}

				if cfg.AppPassword != tt.password {
					t.Fatal("app password was altered")
				}

				return
			}

			if err == nil {
				t.Fatal("expected an error for an APP_PASSWORD exceeding the login body budget")
			}

			if tt.password != "" && strings.Contains(err.Error(), tt.password) {
				t.Fatalf("error leaked APP_PASSWORD value: %v", err)
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
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		w.WriteHeader(http.StatusOK)
		close(finished)
	})
	done := make(chan error, 1)
	go func() {
		done <- serveUntilExit(ctx, listener, handler, func() {
			select {
			case <-finished:
			default:
				t.Error("workers stopped before handler completed")
			}
			close(stopped)
		})
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
		done <- serveUntilExit(ctx, listener, handler, func() { close(stopped) })
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
	released := false
	defer func() {
		if !released {
			close(release)
		}
	}()
	stopped := make(chan struct{})
	done := make(chan error, 1)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-r.Context().Done()
		close(canceled)
		<-release
	})
	go func() {
		done <- serveUntilExitWithTimeout(ctx, listener, handler, func() { close(stopped) }, 20*time.Millisecond)
	}()
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, "http://"+listener.Addr().String()+"/", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}

	go func() {
		resp, err := http.DefaultClient.Do(req)
		if err == nil {
			_ = resp.Body.Close()
		}
	}()

	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("handler did not start")
	}

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

	close(release)
	released = true
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("serveUntilExit error = %v, want deadline exceeded", err)
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

func TestLoadConfigAppURLValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		appURL string
		env    map[string]string
		secret string
		wantOK bool
	}{
		{name: "short session secret", env: map[string]string{"SESSION_SECRET": "too-short-secret-value"}, secret: "too-short-secret-value"},
		{name: "invalid timezone", env: map[string]string{"TZ": "Mars/Olympus_Mons"}},
		{name: "http localhost", appURL: "http://localhost:8080", wantOK: true},
		{name: "https host", appURL: "https://reader.example.com", wantOK: true},
		{name: "uppercase HTTP", appURL: "HTTP://EXAMPLE.COM", wantOK: true},
		{name: "mixed-case HTTPS with port", appURL: "HtTpS://reader.example.com:8443", wantOK: true},
		{name: "ftp scheme", appURL: "ftp://reader.example.com", wantOK: false},
		{name: "javascript scheme", appURL: "javascript://reader.example.com", wantOK: false},
		{name: "ws scheme", appURL: "ws://reader.example.com", wantOK: false},
		{name: "malformed url", appURL: "://bad", wantOK: false},
		{name: "relative url", appURL: "/relative", wantOK: false},
		{name: "missing hostname", appURL: "http://:8080", wantOK: false},
		{name: "embedded credentials", appURL: "https://user:topsecret@reader.example.com", wantOK: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			env := map[string]string{"APP_PASSWORD": "secret", "APP_URL": tt.appURL}
			for key, value := range tt.env {
				env[key] = value
			}
			cfg, err := loadConfig(getenvFrom(env))
			if tt.wantOK {
				if err != nil {
					t.Fatalf("load config: %v", err)
				}

				if cfg.AppURL != tt.appURL {
					t.Fatalf("app url = %q, want %q", cfg.AppURL, tt.appURL)
				}

				return
			}

			if err == nil {
				t.Fatalf("expected error for APP_URL %q", tt.appURL)
			}

			if (tt.appURL != "" && strings.Contains(err.Error(), tt.appURL)) || strings.Contains(err.Error(), "topsecret") || (tt.secret != "" && strings.Contains(err.Error(), tt.secret)) {
				t.Fatalf("error leaked raw APP_URL or credentials: %v", err)
			}
		})
	}
}

func TestRecoverStartupStateCleansSpoolAndRecoversRunningSends(t *testing.T) {
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

	if err := store.Settings().UpdateKindle(ctx, domain.KindleSettings{
		KindleEmail: "reader@kindle.com",
	}); err != nil {
		t.Fatalf("UpdateKindle() error = %v", err)
	}

	startedAt := time.Date(2026, 3, 15, 8, 0, 0, 0, time.UTC)
	if _, err := store.KindleSends().ClaimManualSend(ctx, domain.NewID(), startedAt); err != nil {
		t.Fatalf("ClaimManualSend() error = %v", err)
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
