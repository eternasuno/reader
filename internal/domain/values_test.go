package domain

import (
	"strings"
	"testing"
)

func TestSnapshotParamsMintBoundary(t *testing.T) {
	t.Parallel()

	params := NewSnapshotParams(true)
	if !params.Unread || !IsValidUUIDv7(params.Boundary) {
		t.Fatalf("unexpected params: %+v", params)
	}
}

func TestBatchIDsValidation(t *testing.T) {
	t.Parallel()

	t.Run("accepts bounds", func(t *testing.T) {
		t.Parallel()

		for _, n := range []int{1, MaxBatchIDs} {
			ids := make([]string, n)
			for i := range ids {
				ids[i] = NewID()
			}

			if err := ValidateBatchIDs(ids); err != nil {
				t.Fatalf("%d ids should be valid: %v", n, err)
			}
		}
	})

	t.Run("rejects empty and oversized", func(t *testing.T) {
		t.Parallel()

		requireDomainError(t, ValidateBatchIDs(nil), ErrRequestFailed)

		ids := make([]string, MaxBatchIDs+1)
		for i := range ids {
			ids[i] = NewID()
		}

		requireDomainError(t, ValidateBatchIDs(ids), ErrRequestFailed)
	})

	t.Run("rejects duplicates", func(t *testing.T) {
		t.Parallel()

		id := NewID()
		requireDomainError(t, ValidateBatchIDs([]string{id, NewID(), id}), ErrRequestFailed)
	})

	t.Run("rejects invalid ids", func(t *testing.T) {
		t.Parallel()

		id := NewID()
		for _, bad := range []string{
			"",
			"   ",
			"abc",
			"00000000-0000-4000-8000-000000000000",
			strings.ToUpper(id),
			strings.ReplaceAll(id, "-", ""),
			"urn:uuid:" + id,
			" " + id,
		} {
			requireDomainError(t, ValidateBatchIDs([]string{NewID(), bad}), ErrRequestFailed)
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

func TestExceedsFeedItemBudget(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		counts    []int
		retention int
		want      bool
	}{
		{counts: nil, retention: FeedItemBudget},
		{counts: []int{0, 0}, retention: FeedItemBudget / 2},
		{counts: []int{0, 0}, retention: FeedItemBudget/2 + 1, want: true},
		{counts: []int{FeedItemBudget - 2, 0}, retention: 2},
		{counts: []int{FeedItemBudget - 1, 0}, retention: 2, want: true},
		{counts: []int{1, 1, 1}, retention: FeedItemBudget / 3},
	} {
		if got := ExceedsFeedItemBudget(test.counts, test.retention); got != test.want {
			t.Fatalf("ExceedsFeedItemBudget(%v, %d) = %v, want %v", test.counts, test.retention, got, test.want)
		}
	}
}

func TestValueValidators(t *testing.T) {
	t.Parallel()

	for _, mode := range []ReaderMode{ReaderModeDefault, ReaderModeExtracted} {
		if err := ValidateReaderMode(mode); err != nil {
			t.Fatalf("mode %q should be valid: %v", mode, err)
		}
	}

	for _, mode := range []ReaderMode{"other", "embedded"} {
		if err := ValidateReaderMode(mode); err == nil {
			t.Fatalf("mode %q should be invalid", mode)
		}
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

func TestValueBrowserlessSettings(t *testing.T) {
	t.Parallel()

	token := " secret "
	blank := "   "
	valid := []struct {
		in   BrowserlessSettings
		want BrowserlessSettings
	}{
		{
			in:   BrowserlessSettings{URL: " https://production-sfo.browserless.io/ ", Token: &token, ResidentialProxy: true},
			want: BrowserlessSettings{URL: "https://production-sfo.browserless.io", Token: &token, ResidentialProxy: true},
		},
		{
			in:   BrowserlessSettings{URL: "http://browserless:3000/base//", Token: &blank},
			want: BrowserlessSettings{URL: "http://browserless:3000/base"},
		},
		{
			in:   BrowserlessSettings{URL: "HTTPS://Browserless.example.com"},
			want: BrowserlessSettings{URL: "HTTPS://Browserless.example.com"},
		},
	}

	for _, tc := range valid {
		got, err := ValidateBrowserlessSettings(tc.in)
		if err != nil {
			t.Fatalf("browserless %+v should be valid: %v", tc.in, err)
		}

		if got.URL != tc.want.URL || got.ResidentialProxy != tc.want.ResidentialProxy || !equalOptional(got.Token, tc.want.Token) {
			t.Fatalf("browserless = %+v, want %+v", got, tc.want)
		}
	}

	invalid := []string{
		"",
		"   ",
		"ws://browserless:3000",
		"ftp://example.com",
		"http://",
		"not a url",
		"example.com:3000",
		"https://user:pass@browserless.example.com",
		"https://browserless.example.com?token=x",
		"https://browserless.example.com?",
		"https://browserless.example.com#frag",
	}
	for _, raw := range invalid {
		_, err := ValidateBrowserlessSettings(BrowserlessSettings{URL: raw})
		requireDomainError(t, err, ErrInvalidBrowserlessSetting)
	}
}

func equalOptional(a, b *string) bool {
	if a == nil || b == nil {
		return a == b
	}

	return *a == *b
}

func TestValueSMTPSettings(t *testing.T) {
	t.Parallel()

	base := func() SMTPSettings {
		return SMTPSettings{
			SenderEmail: " sender@example.com ",
			Host:        " smtp.example.com ",
			Port:        465,
			Security:    SMTPSecurityTLS,
			User:        strPtr("  smtp-user  "),
			Password:    strPtr("secret"),
		}
	}

	settings, err := ValidateSMTPSettings(base())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if settings.SenderEmail != "sender@example.com" {
		t.Fatalf("sender email = %q", settings.SenderEmail)
	}

	if settings.Host != "smtp.example.com" {
		t.Fatalf("host = %q", settings.Host)
	}

	if settings.User == nil || *settings.User != "smtp-user" {
		t.Fatalf("user = %v, want smtp-user", settings.User)
	}

	if settings.Password == nil || *settings.Password != "secret" {
		t.Fatalf("password = %v, want secret", settings.Password)
	}

	blankUser := base()
	blankUser.User = strPtr("   ")
	blankUser.Security = SMTPSecuritySTARTTLS
	blankUser.Port = 587
	settings, err = ValidateSMTPSettings(blankUser)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if settings.User != nil {
		t.Fatalf("blank user = %v, want nil", *settings.User)
	}

	nilUser := base()
	nilUser.User = nil
	settings, err = ValidateSMTPSettings(nilUser)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if settings.User != nil {
		t.Fatalf("nil user = %v, want nil", *settings.User)
	}

	invalidCases := map[string]func(*SMTPSettings){
		"empty sender email":   func(s *SMTPSettings) { s.SenderEmail = "  " },
		"invalid sender email": func(s *SMTPSettings) { s.SenderEmail = "sender" },
		"sender email bad host": func(s *SMTPSettings) {
			s.SenderEmail = "reader@bad-.example"
		},
		"sender email display": func(s *SMTPSettings) { s.SenderEmail = "Display <a@b.com>" },
		"empty local part":     func(s *SMTPSettings) { s.SenderEmail = "@example.com" },
		"empty domain":         func(s *SMTPSettings) { s.SenderEmail = "sender@" },
		"empty host":           func(s *SMTPSettings) { s.Host = "  " },
		"port zero":            func(s *SMTPSettings) { s.Port = 0 },
		"port too large":       func(s *SMTPSettings) { s.Port = 65536 },
		"port negative":        func(s *SMTPSettings) { s.Port = -1 },
		"unknown security":     func(s *SMTPSettings) { s.Security = SMTPSecurity("ssl") },
		"empty security":       func(s *SMTPSettings) { s.Security = "" },
	}

	for name, mutate := range invalidCases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			input := base()
			mutate(&input)
			_, err := ValidateSMTPSettings(input)
			requireDomainError(t, err, ErrInvalidSMTPSetting)
		})
	}
}

func TestValueKindleSettings(t *testing.T) {
	t.Parallel()

	base := func() KindleSettings {
		return KindleSettings{
			Language:    KindleLanguageChinese,
			KindleEmail: "kindle@example.com",
			Schedule:    &KindleSchedule{Hour: 8, Minute: 0, Timezone: "UTC"},
		}
	}

	t.Run("normalizes", func(t *testing.T) {
		t.Parallel()

		input := base()
		input.KindleEmail = "  kindle@example.com "
		input.Schedule.Timezone = " America/New_York "

		settings, err := ValidateKindleSettings(input)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if settings.KindleEmail != "kindle@example.com" {
			t.Fatalf("kindle email = %q", settings.KindleEmail)
		}

		if settings.Schedule == nil || *settings.Schedule != (KindleSchedule{Hour: 8, Minute: 0, Timezone: "America/New_York"}) {
			t.Fatalf("schedule = %v", settings.Schedule)
		}
	})

	t.Run("schedule off clears the schedule", func(t *testing.T) {
		t.Parallel()

		input := base()
		input.Schedule = nil

		settings, err := ValidateKindleSettings(input)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if settings.Schedule != nil {
			t.Fatalf("settings = %+v, want no schedule", settings)
		}
	})

	t.Run("schedule bounds", func(t *testing.T) {
		t.Parallel()

		for _, schedule := range []KindleSchedule{
			{Hour: 0, Minute: 0, Timezone: "UTC"},
			{Hour: 8, Minute: 5, Timezone: "UTC"},
			{Hour: 12, Minute: 30, Timezone: "UTC"},
			{Hour: 23, Minute: 55, Timezone: "UTC"},
		} {
			input := base()
			input.Schedule = &schedule

			if _, err := ValidateKindleSettings(input); err != nil {
				t.Fatalf("schedule %+v should be valid: %v", schedule, err)
			}
		}
	})

	invalidCases := map[string]func(*KindleSettings){
		"empty kindle email":      func(k *KindleSettings) { k.KindleEmail = " " },
		"missing language":        func(k *KindleSettings) { k.Language = "" },
		"unsupported language":    func(k *KindleSettings) { k.Language = "fr" },
		"kindle email without at": func(k *KindleSettings) { k.KindleEmail = "kindle.example.com" },
		"kindle email double at":  func(k *KindleSettings) { k.KindleEmail = "a@@b" },
		"kindle email bad host":   func(k *KindleSettings) { k.KindleEmail = "reader@-bad.example" },
		"kindle email display":    func(k *KindleSettings) { k.KindleEmail = "Display <a@b.com>" },
		"empty local part":        func(k *KindleSettings) { k.KindleEmail = "@example.com" },
		"empty domain":            func(k *KindleSettings) { k.KindleEmail = "kindle@" },
		"empty timezone":          func(k *KindleSettings) { k.Schedule.Timezone = "" },
		"blank timezone":          func(k *KindleSettings) { k.Schedule.Timezone = "   " },
		"local timezone":          func(k *KindleSettings) { k.Schedule.Timezone = "Local" },
		"unknown timezone":        func(k *KindleSettings) { k.Schedule.Timezone = "Mars/Olympus" },
		"hour below range":        func(k *KindleSettings) { k.Schedule.Hour = -1 },
		"hour above range":        func(k *KindleSettings) { k.Schedule.Hour = 24 },
		"minute off step":         func(k *KindleSettings) { k.Schedule.Minute = 3 },
		"minute above range":      func(k *KindleSettings) { k.Schedule.Minute = 60 },
		"minute negative":         func(k *KindleSettings) { k.Schedule.Minute = -5 },
	}

	for name, mutate := range invalidCases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			settings := base()
			mutate(&settings)
			_, err := ValidateKindleSettings(settings)
			requireDomainError(t, err, ErrInvalidKindleSetting)
		})
	}
}

func strPtr(value string) *string {
	return &value
}
