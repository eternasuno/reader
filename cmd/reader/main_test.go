package main

import (
	"bytes"
	"testing"
	"time"
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
		"SESSION_SECRET":        "fixed-secret",
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

	if string(cfg.SessionSecret) != "fixed-secret" {
		t.Fatalf("session secret = %q, want fixed-secret", cfg.SessionSecret)
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
