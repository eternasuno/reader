package domain

import (
	"strings"
	"testing"
	"time"
)

func TestPageParamsValidation(t *testing.T) {
	t.Parallel()

	t.Run("defaults", func(t *testing.T) {
		t.Parallel()

		params, err := ValidatePageParams(0, false, false, "", nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if params.Limit != 30 {
			t.Fatalf("limit = %d, want 30", params.Limit)
		}

		if params.Order != SortOrderNewest {
			t.Fatalf("order = %q, want newest", params.Order)
		}

		if params.Unread {
			t.Fatalf("unread should default to false")
		}

		if params.Cursor != nil {
			t.Fatalf("cursor should default to nil")
		}
	})

	t.Run("accepts bounds", func(t *testing.T) {
		t.Parallel()

		for _, limit := range []int{1, 200} {
			if _, err := ValidatePageParams(limit, true, true, SortOrderOldest, nil); err != nil {
				t.Fatalf("limit %d should be valid: %v", limit, err)
			}
		}
	})

	t.Run("rejects out of range limits", func(t *testing.T) {
		t.Parallel()

		for _, limit := range []int{-1, 0, 201, 1000} {
			_, err := ValidatePageParams(limit, true, false, SortOrderNewest, nil)
			requireDomainError(t, err, ErrRequestFailed)
		}
	})

	t.Run("rejects invalid order", func(t *testing.T) {
		t.Parallel()

		_, err := ValidatePageParams(30, true, false, SortOrder("random"), nil)
		requireDomainError(t, err, ErrRequestFailed)
	})

	t.Run("valid cursor", func(t *testing.T) {
		t.Parallel()

		cursor := NewID()
		params, err := ValidatePageParams(10, true, true, SortOrderOldest, &cursor)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if params.Cursor == nil || *params.Cursor != cursor {
			t.Fatalf("cursor = %v, want %q", params.Cursor, cursor)
		}

		if !params.Unread || params.Order != SortOrderOldest || params.Limit != 10 {
			t.Fatalf("unexpected params: %+v", params)
		}
	})

	t.Run("rejects blank cursor", func(t *testing.T) {
		t.Parallel()

		for _, blank := range []string{"", "   "} {
			_, err := ValidatePageParams(30, true, false, SortOrderNewest, &blank)
			requireDomainError(t, err, ErrRequestFailed)
		}
	})

	t.Run("rejects invalid cursor", func(t *testing.T) {
		t.Parallel()

		id := NewID()
		for _, cursor := range []string{
			"abc",
			"00000000-0000-4000-8000-000000000000",
			strings.ToUpper(id),
			strings.ReplaceAll(id, "-", ""),
			"urn:uuid:" + id,
			" " + id,
		} {
			_, err := ValidatePageParams(30, true, false, SortOrderNewest, &cursor)
			requireDomainError(t, err, ErrRequestFailed)
		}
	})
}

func TestValueArticleNormalization(t *testing.T) {
	t.Parallel()

	title, description, content := NormalizeArticleValues("  Hello  ", strPtr("  desc  "), strPtr("  body  "))
	if title != "Hello" {
		t.Fatalf("title = %q, want Hello", title)
	}

	if description == nil || *description != "desc" {
		t.Fatalf("description = %v", description)
	}

	if content == nil || *content != "body" {
		t.Fatalf("content = %v", content)
	}

	title, description, content = NormalizeArticleValues("   ", strPtr("  "), nil)
	if title != "Untitled" {
		t.Fatalf("title = %q, want Untitled", title)
	}

	if description != nil {
		t.Fatalf("description = %v, want nil", *description)
	}

	if content != nil {
		t.Fatalf("content = %v, want nil", *content)
	}

	title, _, _ = NormalizeArticleValues("", nil, nil)
	if title != "Untitled" {
		t.Fatalf("title = %q, want Untitled", title)
	}
}

func TestValueFolderName(t *testing.T) {
	t.Parallel()

	name, err := ValidateFolderName("  技术  ")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if name != "技术" {
		t.Fatalf("name = %q, want 技术", name)
	}

	for _, raw := range []string{"", "   ", "\t\n"} {
		_, err := ValidateFolderName(raw)
		requireDomainError(t, err, ErrInvalidFolderName)
	}
}

func TestValueValidators(t *testing.T) {
	t.Parallel()

	for _, mode := range []ReaderMode{ReaderModeDefault, ReaderModeExtracted, ReaderModeEmbedded} {
		if err := ValidateReaderMode(mode); err != nil {
			t.Fatalf("mode %q should be valid: %v", mode, err)
		}
	}

	if err := ValidateReaderMode(ReaderMode("other")); err == nil {
		t.Fatalf("unexpected valid reader mode")
	}

	for _, order := range []SortOrder{SortOrderNewest, SortOrderOldest} {
		if err := ValidateSortOrder(order); err != nil {
			t.Fatalf("order %q should be valid: %v", order, err)
		}
	}

	if err := ValidateSortOrder(SortOrder("")); err == nil {
		t.Fatalf("unexpected valid sort order")
	}

	if err := ValidateRetention(1); err != nil {
		t.Fatalf("retention 1 should be valid: %v", err)
	}

	if err := ValidateRetention(500); err != nil {
		t.Fatalf("retention 500 should be valid: %v", err)
	}

	for _, n := range []int{0, -1, -100} {
		requireDomainError(t, ValidateRetention(n), ErrInvalidRetention)
	}
}

func TestValueBrowserEndpoint(t *testing.T) {
	t.Parallel()

	valid := []struct {
		in   string
		want string
	}{
		{in: " http://localhost:9222 ", want: "http://localhost:9222"},
		{in: "https://browser.example.com", want: "https://browser.example.com"},
		{in: "ws://127.0.0.1:9222/devtools/browser/abc", want: "ws://127.0.0.1:9222/devtools/browser/abc"},
		{in: "WSS://browser.example.com/devtools", want: "WSS://browser.example.com/devtools"},
	}

	for _, tc := range valid {
		got, err := ValidateBrowserEndpoint(tc.in)
		if err != nil {
			t.Fatalf("endpoint %q should be valid: %v", tc.in, err)
		}

		if got != tc.want {
			t.Fatalf("endpoint = %q, want %q", got, tc.want)
		}
	}

	invalid := []string{"", "   ", "ftp://example.com", "http://", "not a url", "example.com:9222"}
	for _, raw := range invalid {
		_, err := ValidateBrowserEndpoint(raw)
		requireDomainError(t, err, ErrInvalidEndpoint)
	}
}

func TestValueSendTime(t *testing.T) {
	t.Parallel()

	valid := []struct {
		in     string
		hour   int
		minute int
	}{
		{in: "00:00", hour: 0, minute: 0},
		{in: "09:30", hour: 9, minute: 30},
		{in: "23:00", hour: 23, minute: 0},
		{in: " 07:30 ", hour: 7, minute: 30},
	}

	for _, tc := range valid {
		hour, minute, err := ValidateSendTime(tc.in)
		if err != nil {
			t.Fatalf("send time %q should be valid: %v", tc.in, err)
		}

		if hour != tc.hour || minute != tc.minute {
			t.Fatalf("send time %q = %02d:%02d, want %02d:%02d", tc.in, hour, minute, tc.hour, tc.minute)
		}
	}

	invalid := []string{"", "24:00", "7:30", "09:15", "09:60", "0930", "aa:bb", "09:3", "-1:00"}
	for _, raw := range invalid {
		_, _, err := ValidateSendTime(raw)
		requireDomainError(t, err, ErrInvalidKindleSetting)
	}
}

func TestNextSendAtDaylightSaving(t *testing.T) {
	t.Parallel()

	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skipf("timezone data unavailable: %v", err)
	}

	now := time.Date(2026, 3, 8, 1, 0, 0, 0, loc)

	next, err := ComputeNextSendAt("02:30", now, loc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := time.Date(2026, 3, 9, 2, 30, 0, 0, loc)
	if !next.Equal(want) {
		t.Fatalf("next = %s, want %s", next.UTC(), want.UTC())
	}

	nextLocal := next.In(loc)
	if nextLocal.Hour() != 2 || nextLocal.Minute() != 30 {
		t.Fatalf("next local time = %02d:%02d, want 02:30", nextLocal.Hour(), nextLocal.Minute())
	}

	next, err = ComputeNextSendAt("09:30", now, loc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if next.In(loc).Hour() != 9 || next.In(loc).Minute() != 30 {
		t.Fatalf("next local time = %s, want 09:30", next.In(loc))
	}

	dayAfter := time.Date(2026, 3, 8, 12, 0, 0, 0, loc)
	next, err = ComputeNextSendAt("02:30", dayAfter, loc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !next.Equal(want) {
		t.Fatalf("next = %s, want %s", next.UTC(), want.UTC())
	}

	fallBackNow := time.Date(2026, 11, 1, 5, 45, 0, 0, time.UTC)
	fallBackNext, err := ComputeNextSendAt("01:30", fallBackNow, loc)
	if err != nil {
		t.Fatalf("unexpected error on fall-back: %v", err)
	}

	wantFallBack := time.Date(2026, 11, 1, 6, 30, 0, 0, time.UTC)
	if !fallBackNext.Equal(wantFallBack) {
		t.Fatalf("fall-back next = %s, want %s", fallBackNext, wantFallBack)
	}
}

func TestNextSendAt(t *testing.T) {
	t.Parallel()

	loc := time.FixedZone("UTC+8", 8*60*60)
	now := time.Date(2026, 3, 1, 9, 0, 0, 0, loc)

	next, err := ComputeNextSendAt("09:30", now, loc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want := time.Date(2026, 3, 1, 1, 30, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("next = %s, want %s", next, want)
	}

	if next.Location() != time.UTC {
		t.Fatalf("next location = %s, want UTC", next.Location())
	}

	next, err = ComputeNextSendAt("08:30", now, loc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want = time.Date(2026, 3, 2, 0, 30, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("next = %s, want %s", next, want)
	}

	next, err = ComputeNextSendAt("09:00", now, loc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want = time.Date(2026, 3, 2, 1, 0, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("next = %s, want %s", next, want)
	}

	utcNow := time.Date(2026, 3, 1, 1, 0, 0, 0, time.UTC)
	next, err = ComputeNextSendAt("09:30", utcNow, loc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want = time.Date(2026, 3, 1, 1, 30, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("next = %s, want %s", next, want)
	}

	next, err = ComputeNextSendAt("09:30", utcNow, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	want = time.Date(2026, 3, 1, 9, 30, 0, 0, time.UTC)
	if !next.Equal(want) {
		t.Fatalf("next = %s, want %s", next, want)
	}

	_, err = ComputeNextSendAt("09:15", now, loc)
	requireDomainError(t, err, ErrInvalidKindleSetting)
}

func TestValueKindleSettings(t *testing.T) {
	t.Parallel()

	loc := time.FixedZone("UTC+8", 8*60*60)
	now := time.Date(2026, 3, 1, 9, 0, 0, 0, loc)

	base := func() KindleSettings {
		sendTime := " 08:00 "
		return KindleSettings{
			KindleEmail:  "  kindle@example.com ",
			SenderEmail:  " sender@example.com ",
			SMTPHost:     " smtp.example.com ",
			SMTPPort:     465,
			SMTPSecurity: SMTPSecurityTLS,
			SendTime:     &sendTime,
		}
	}

	settings, err := ValidateKindleSettings(base(), now, loc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if settings.KindleEmail != "kindle@example.com" {
		t.Fatalf("kindle email = %q", settings.KindleEmail)
	}

	if settings.SenderEmail != "sender@example.com" {
		t.Fatalf("sender email = %q", settings.SenderEmail)
	}

	if settings.SMTPHost != "smtp.example.com" {
		t.Fatalf("smtp host = %q", settings.SMTPHost)
	}

	if settings.SendTime == nil || *settings.SendTime != "08:00" {
		t.Fatalf("send time = %v", settings.SendTime)
	}

	wantNext := time.Date(2026, 3, 2, 0, 0, 0, 0, time.UTC)
	if settings.NextSendAt == nil || !settings.NextSendAt.Equal(wantNext) {
		t.Fatalf("next send at = %v, want %s", settings.NextSendAt, wantNext)
	}

	withoutTime := base()
	withoutTime.SendTime = nil
	settings, err = ValidateKindleSettings(withoutTime, now, loc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if settings.SendTime != nil || settings.NextSendAt != nil {
		t.Fatalf("send time should be cleared")
	}

	blankTime := base()
	empty := "   "
	blankTime.SendTime = &empty
	blankTime.SMTPSecurity = SMTPSecuritySTARTTLS
	settings, err = ValidateKindleSettings(blankTime, now, loc)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if settings.SendTime != nil || settings.NextSendAt != nil {
		t.Fatalf("blank send time should be cleared")
	}

	invalidCases := map[string]func(*KindleSettings){
		"empty kindle email":      func(k *KindleSettings) { k.KindleEmail = " " },
		"kindle email without at": func(k *KindleSettings) { k.KindleEmail = "kindle.example.com" },
		"kindle email double at":  func(k *KindleSettings) { k.KindleEmail = "a@@b" },
		"kindle email bad host":   func(k *KindleSettings) { k.KindleEmail = "reader@-bad.example" },
		"sender email bad host":   func(k *KindleSettings) { k.SenderEmail = "reader@bad-.example" },
		"kindle email display":    func(k *KindleSettings) { k.KindleEmail = "Display <a@b.com>" },
		"sender email display":    func(k *KindleSettings) { k.SenderEmail = "Display <a@b.com>" },
		"empty local part":        func(k *KindleSettings) { k.KindleEmail = "@example.com" },
		"empty domain":            func(k *KindleSettings) { k.KindleEmail = "kindle@" },
		"empty sender email":      func(k *KindleSettings) { k.SenderEmail = "  " },
		"invalid sender email":    func(k *KindleSettings) { k.SenderEmail = "sender" },
		"empty smtp host":         func(k *KindleSettings) { k.SMTPHost = "  " },
		"port zero":               func(k *KindleSettings) { k.SMTPPort = 0 },
		"port too large":          func(k *KindleSettings) { k.SMTPPort = 65536 },
		"port negative":           func(k *KindleSettings) { k.SMTPPort = -1 },
		"unknown security":        func(k *KindleSettings) { k.SMTPSecurity = SMTPSecurity("ssl") },
		"empty security":          func(k *KindleSettings) { k.SMTPSecurity = "" },
		"invalid send time": func(k *KindleSettings) {
			bad := "25:00"
			k.SendTime = &bad
		},
		"invalid send minute": func(k *KindleSettings) {
			bad := "09:15"
			k.SendTime = &bad
		},
	}

	for name, mutate := range invalidCases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			settings := base()
			mutate(&settings)
			_, err := ValidateKindleSettings(settings, now, loc)
			requireDomainError(t, err, ErrInvalidKindleSetting)
		})
	}
}

func strPtr(value string) *string {
	return &value
}
