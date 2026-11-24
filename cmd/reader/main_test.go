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
	cfg, err := loadConfig(getenvFrom(map[string]string{"APP_PASSWORD": "secret"}))
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.AppPassword != "secret" {
		t.Fatalf("app password = %q, want secret", cfg.AppPassword)
	}

	if cfg.AppURL != "http://localhost:8080" {
		t.Fatalf("app url = %q, want default", cfg.AppURL)
	}

	if cfg.Port != "8080" {
		t.Fatalf("port = %q, want 8080", cfg.Port)
	}

	if cfg.DataDir != ".data" {
		t.Fatalf("data dir = %q, want .data", cfg.DataDir)
	}

	if len(cfg.SessionSecret) != 32 {
		t.Fatalf("session secret length = %d, want 32", len(cfg.SessionSecret))
	}

	if bytes.Equal(cfg.SessionSecret, make([]byte, 32)) {
		t.Fatal("session secret must not be all zero bytes")
	}

	if cfg.Location != time.Local {
		t.Fatalf("location = %v, want time.Local", cfg.Location)
	}

	if cfg.AllowPrivateNetwork {
		t.Fatal("allow private network = true, want false")
	}
}

func TestLoadConfigOverrides(t *testing.T) {
	cfg, err := loadConfig(getenvFrom(map[string]string{
		"APP_PASSWORD":          "hunter2",
		"APP_URL":               "https://reader.example.com",
		"PORT":                  "9000",
		"DATA_DIR":              "/var/lib/reader",
		"SESSION_SECRET":        "fixed-secret-0123456789abcdef01234",
		"TZ":                    "Asia/Shanghai",
		"ALLOW_PRIVATE_NETWORK": "TRUE",
	}))
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	if cfg.AppPassword != "hunter2" {
		t.Fatalf("app password = %q", cfg.AppPassword)
	}

	if cfg.AppURL != "https://reader.example.com" {
		t.Fatalf("app url = %q", cfg.AppURL)
	}

	if cfg.Port != "9000" {
		t.Fatalf("port = %q", cfg.Port)
	}

	if cfg.DataDir != "/var/lib/reader" {
		t.Fatalf("data dir = %q", cfg.DataDir)
	}

	if string(cfg.SessionSecret) != "fixed-secret-0123456789abcdef01234" {
		t.Fatalf("session secret = %q, want fixed-secret-0123456789abcdef01234", cfg.SessionSecret)
	}

	if cfg.Location == nil || cfg.Location.String() != "Asia/Shanghai" {
		t.Fatalf("location = %v, want Asia/Shanghai", cfg.Location)
	}

	if !cfg.AllowPrivateNetwork {
		t.Fatal("allow private network = false, want true")
	}
}

func TestLoadConfigRequiresPassword(t *testing.T) {
	if _, err := loadConfig(getenvFrom(map[string]string{})); err == nil {
		t.Fatal("expected error for missing APP_PASSWORD")
	}
}

func TestLoadConfigRejectsShortSessionSecret(t *testing.T) {
	shortSecret := "too-short-secret-value"
	_, err := loadConfig(getenvFrom(map[string]string{
		"APP_PASSWORD":   "secret",
		"SESSION_SECRET": shortSecret,
	}))
	if err == nil {
		t.Fatal("expected error for short SESSION_SECRET")
	}

	if strings.Contains(err.Error(), shortSecret) {
		t.Fatalf("error leaked SESSION_SECRET value: %v", err)
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

			if strings.Contains(err.Error(), tt.password) {
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
	stopped := false
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	done := make(chan error, 1)
	go func() {
		done <- serveUntilExit(ctx, listener, handler, func() { stopped = true })
	}()

	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, "http://"+listener.Addr().String()+"/", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("get server: %v", err)
	}
	_ = resp.Body.Close()

	cancel()

	if err := <-done; err != nil {
		t.Fatalf("serveUntilExit error = %v", err)
	}

	if !stopped {
		t.Fatal("expected stopWorkers to run on shutdown")
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

func TestLoadConfigRejectsInvalidTimeZone(t *testing.T) {
	_, err := loadConfig(getenvFrom(map[string]string{
		"APP_PASSWORD": "secret",
		"TZ":           "Mars/Olympus_Mons",
	}))
	if err == nil {
		t.Fatal("expected error for invalid TZ")
	}
}

func TestLoadConfigGeneratesDistinctSecrets(t *testing.T) {
	getenv := getenvFrom(map[string]string{"APP_PASSWORD": "secret"})

	first, err := loadConfig(getenv)
	if err != nil {
		t.Fatalf("load first config: %v", err)
	}

	second, err := loadConfig(getenv)
	if err != nil {
		t.Fatalf("load second config: %v", err)
	}

	if bytes.Equal(first.SessionSecret, second.SessionSecret) {
		t.Fatal("generated session secrets must differ between startups")
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
