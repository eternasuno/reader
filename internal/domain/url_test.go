package domain

import (
	"errors"
	"strings"
	"testing"
)

func requireDomainError(t *testing.T, err error, want ErrorCode) {
	t.Helper()

	var domainErr *DomainError
	if !errors.As(err, &domainErr) {
		t.Fatalf("expected *DomainError, got %v", err)
	}

	if domainErr.Code != want {
		t.Fatalf("expected code %s, got %s", want, domainErr.Code)
	}
}

func TestURLParseNormalized(t *testing.T) {
	t.Parallel()

	successCases := []struct {
		name         string
		raw          string
		wantRaw      string
		wantRedacted string
		wantHost     string
		wantCreds    bool
		wantUser     string
		wantPass     string
		wantHasPass  bool
	}{
		{
			name:         "empty path becomes root",
			raw:          "https://example.com",
			wantRaw:      "https://example.com/",
			wantRedacted: "https://example.com/",
			wantHost:     "example.com",
		},
		{
			name:         "trims whitespace and lowercases scheme and host",
			raw:          "  HTTPS://Example.COM/Path/  ",
			wantRaw:      "https://example.com/Path/",
			wantRedacted: "https://example.com/Path/",
			wantHost:     "example.com",
		},
		{
			name:         "strips default https port and fragment",
			raw:          "https://example.com:443/a#section",
			wantRaw:      "https://example.com/a",
			wantRedacted: "https://example.com/a",
			wantHost:     "example.com",
		},
		{
			name:         "strips default http port",
			raw:          "HTTP://example.com:80/a",
			wantRaw:      "http://example.com/a",
			wantRedacted: "http://example.com/a",
			wantHost:     "example.com",
		},
		{
			name:         "preserves non default port",
			raw:          "http://example.com:8080/x",
			wantRaw:      "http://example.com:8080/x",
			wantRedacted: "http://example.com:8080/x",
			wantHost:     "example.com",
		},
		{
			name:         "strips tracking parameters and keeps others",
			raw:          "https://example.com/a?utm_source=x&UTM_Medium=y&gclid=1&keep=2#frag",
			wantRaw:      "https://example.com/a?keep=2",
			wantRedacted: "https://example.com/a?keep=2",
			wantHost:     "example.com",
		},
		{
			name:         "keeps only untracked query parameters",
			raw:          "https://example.com/a?dclid=1&gbraid=2&wbraid=3&fbclid=4&msclkid=5&yclid=6&twclid=7&ttclid=8&li_fat_id=9&igshid=10&mc_cid=11&mc_eid=12&_hsenc=13&_hsmi=14&mkt_tok=15&_ga=16&_gl=17&a=1&b=2",
			wantRaw:      "https://example.com/a?a=1&b=2",
			wantRedacted: "https://example.com/a?a=1&b=2",
			wantHost:     "example.com",
		},
		{
			name:         "removes empty query after stripping tracking",
			raw:          "https://example.com/a?utm_campaign=spring",
			wantRaw:      "https://example.com/a",
			wantRedacted: "https://example.com/a",
			wantHost:     "example.com",
		},
		{
			name:         "keeps credentials in raw and strips in redacted",
			raw:          "https://user:secret@example.com/feed",
			wantRaw:      "https://user:secret@example.com/feed",
			wantRedacted: "https://example.com/feed",
			wantHost:     "example.com",
			wantCreds:    true,
			wantUser:     "user",
			wantPass:     "secret",
			wantHasPass:  true,
		},
		{
			name:         "keeps username only credential",
			raw:          "http://token@example.com/feed",
			wantRaw:      "http://token@example.com/feed",
			wantRedacted: "http://example.com/feed",
			wantHost:     "example.com",
			wantCreds:    true,
			wantUser:     "token",
		},
		{
			name:         "preserves www and apex distinction and trailing slash",
			raw:          "https://www.example.com/feed/",
			wantRaw:      "https://www.example.com/feed/",
			wantRedacted: "https://www.example.com/feed/",
			wantHost:     "www.example.com",
		},
		{
			name:         "brackets ipv6 host without port",
			raw:          "http://[::1]:80/x",
			wantRaw:      "http://[::1]/x",
			wantRedacted: "http://[::1]/x",
			wantHost:     "::1",
		},
	}

	for _, tc := range successCases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, err := ParseNormalizedURL(tc.raw, ErrFeedUrlInvalid)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			if got.Raw() != tc.wantRaw {
				t.Fatalf("raw = %q, want %q", got.Raw(), tc.wantRaw)
			}

			if got.RedactedString() != tc.wantRedacted {
				t.Fatalf("redacted = %q, want %q", got.RedactedString(), tc.wantRedacted)
			}

			if got.Host() != tc.wantHost {
				t.Fatalf("host = %q, want %q", got.Host(), tc.wantHost)
			}

			if got.HasCredentials() != tc.wantCreds {
				t.Fatalf("hasCreds = %v, want %v", got.HasCredentials(), tc.wantCreds)
			}

			username, password, ok := got.BasicAuth()
			if ok != tc.wantCreds {
				t.Fatalf("BasicAuth ok = %v, want %v", ok, tc.wantCreds)
			}

			if username != tc.wantUser {
				t.Fatalf("username = %q, want %q", username, tc.wantUser)
			}

			if password != tc.wantPass {
				t.Fatalf("password = %q, want %q", password, tc.wantPass)
			}

			if got.hasPass != tc.wantHasPass {
				t.Fatalf("hasPass = %v, want %v", got.hasPass, tc.wantHasPass)
			}

			parsed, err := got.Parsed()
			if err != nil {
				t.Fatalf("parsed raw error: %v", err)
			}

			if parsed.Fragment != "" {
				t.Fatalf("fragment = %q, want empty", parsed.Fragment)
			}
		})
	}
}

func TestURLParseNormalizedInvalid(t *testing.T) {
	t.Parallel()

	cases := []string{
		"",
		"   ",
		"ftp://example.com/feed",
		"https://",
		"//example.com/feed",
		"/relative/path",
		"not a url at all",
	}

	for _, raw := range cases {
		t.Run(raw, func(t *testing.T) {
			t.Parallel()

			_, err := ParseNormalizedURL(raw, ErrFeedUrlInvalid)
			requireDomainError(t, err, ErrFeedUrlInvalid)
		})
	}

	_, err := ParseNormalizedURL("ftp://example.com", ErrInvalidPageUrl)
	requireDomainError(t, err, ErrInvalidPageUrl)
}

func TestParseStoredNormalizedURL(t *testing.T) {
	t.Parallel()

	parsedStored, err := ParseStoredNormalizedURL("https://user:secret@example.com/feed")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if parsedStored.RedactedString() != "https://example.com/feed" {
		t.Fatalf("parsed redacted = %q", parsedStored.RedactedString())
	}

	if !parsedStored.HasCredentials() {
		t.Fatalf("expected credentials")
	}

	if _, err := ParseStoredNormalizedURL("not a url at all"); err == nil {
		t.Fatalf("expected malformed stored url to fail")
	} else {
		requireDomainError(t, err, ErrFeedUrlInvalid)
	}
}

func TestOriginFromURL(t *testing.T) {
	t.Parallel()

	parse := func(raw string) Origin {
		t.Helper()
		parsed, err := ParseNormalizedURL(raw, ErrFeedUrlInvalid)
		if err != nil {
			t.Fatalf("parse %q: %v", raw, err)
		}

		u, err := parsed.Parsed()
		if err != nil {
			t.Fatalf("parsed %q: %v", raw, err)
		}

		origin, ok := OriginFromURL(u)
		if !ok {
			t.Fatalf("OriginFromURL(%q) = false", raw)
		}

		return origin
	}

	if parse("HTTPS://Example.COM:443/a") != parse("https://example.com/b") {
		t.Fatal("expected normalized default HTTPS port and lowercase host/scheme to match")
	}

	if parse("http://example.com:80/a") != parse("http://example.com/b") {
		t.Fatal("expected normalized default HTTP port to match")
	}

	if parse("https://example.com:8443/a") == parse("https://example.com/a") {
		t.Fatal("expected different port to differ")
	}

	if parse("https://example.com/a") == parse("http://example.com/a") {
		t.Fatal("expected different scheme to differ")
	}

	if _, ok := OriginFromURL(nil); ok {
		t.Fatal("expected nil URL to return ok=false")
	}
}

func TestURLParseNormalizedErrorRedactsCredentials(t *testing.T) {
	t.Parallel()

	for _, input := range []string{
		"http://secretuser:secretpass@example.com:badport/feed",
		"http://secretuser:secret pass@example.com/feed",
	} {
		_, err := ParseNormalizedURL(input, ErrFeedUrlInvalid)
		if err == nil {
			t.Fatalf("expected an error for %q", input)
		}

		requireDomainError(t, err, ErrFeedUrlInvalid)

		message := err.Error()
		if strings.Contains(message, "secretuser") || strings.Contains(message, "secret") {
			t.Fatalf("error leaked credentials for %q: %q", input, message)
		}
	}
}

func TestURLSanitizeErrorText(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		in   string
		want string
	}{
		{name: "empty", in: "", want: ""},
		{name: "no url", in: "connection refused", want: "connection refused"},
		{name: "user info", in: "fetch https://user:secret@example.com/feed failed", want: "fetch https://example.com/feed failed"},
		{name: "encoded password", in: "fetch http://user:p%40ss@example.com/feed failed", want: "fetch http://example.com/feed failed"},
		{name: "malformed url with credentials", in: `parse "http://user:p%40ss@example.com:badport/feed": invalid port ":badport" after host`, want: `parse "http://example.com:badport/feed": invalid port ":badport" after host`},
		{name: "username only", in: "boom http://token@example.com/x", want: "boom http://example.com/x"},
		{name: "uppercase scheme", in: "HTTPS://user:secret@Example.com/feed", want: "HTTPS://Example.com/feed"},
		{name: "multiple urls", in: "https://a:b@one.com/x and http://c@two.com/y", want: "https://one.com/x and http://two.com/y"},
		{name: "path with at sign", in: "https://example.com/user@example.com", want: "https://example.com/user@example.com"},
		{name: "non http scheme untouched", in: "smtp://user:secret@example.com:465", want: "smtp://user:secret@example.com:465"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			if got := SanitizeErrorText(tc.in); got != tc.want {
				t.Fatalf("SanitizeErrorText(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestURLIsValidUUIDv7(t *testing.T) {
	t.Parallel()

	id := NewID()
	if len(id) != 36 {
		t.Fatalf("id = %q, want 36 characters", id)
	}

	if !IsValidUUIDv7(id) {
		t.Fatalf("NewID result %q should be valid UUIDv7", id)
	}

	invalid := []string{
		"",
		"abc",
		"00000000-0000-4000-8000-000000000000",
		"00000000-0000-0000-0000-000000000000",
		strings.ToUpper(id),
		strings.ReplaceAll(id, "-", ""),
		"urn:uuid:" + id,
		"{" + id + "}",
	}

	for _, raw := range invalid {
		if IsValidUUIDv7(raw) {
			t.Fatalf("expected %q to be invalid UUIDv7", raw)
		}
	}
}
