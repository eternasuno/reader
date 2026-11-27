package domain

import (
	"net/mail"
	"net/url"
	"strings"
)

// NewSnapshotParams mints the snapshot boundary before any read.
func NewSnapshotParams(unread bool) SnapshotParams {
	return SnapshotParams{Unread: unread, Boundary: NewID()}
}

// ValidateBatchIDs accepts 1..MaxBatchIDs distinct canonical UUIDv7 ids.
func ValidateBatchIDs(ids []string) error {
	if len(ids) < 1 || len(ids) > MaxBatchIDs {
		return NewError(ErrRequestFailed, nil)
	}

	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if !IsValidUUIDv7(id) {
			return NewError(ErrRequestFailed, nil)
		}

		if _, dup := seen[id]; dup {
			return NewError(ErrRequestFailed, nil)
		}

		seen[id] = struct{}{}
	}

	return nil
}

func NormalizeArticleValues(title string, description, content *string) (string, *string, *string) {
	normTitle := strings.TrimSpace(title)
	if normTitle == "" {
		normTitle = "Untitled"
	}

	return normTitle, trimOptional(description), trimOptional(content)
}

func ValidateFolderName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", NewError(ErrInvalidFolderName, nil)
	}

	return name, nil
}

func ValidateReaderMode(mode ReaderMode) error {
	switch mode {
	case ReaderModeDefault, ReaderModeExtracted:
		return nil
	}

	return NewError(ErrRequestFailed, nil)
}

func ValidateSortOrder(order SortOrder) error {
	switch order {
	case SortOrderNewest, SortOrderOldest:
		return nil
	}

	return NewError(ErrRequestFailed, nil)
}

func ValidateRetention(n int) error {
	if n < 1 || n > FeedItemBudget {
		return NewError(ErrInvalidRetention, nil)
	}

	return nil
}

// ExceedsFeedItemBudget reports whether feeds holding storedCounts items could grow past
// FeedItemBudget: each feed may hold max(its stored count, retention) items, because feeds
// above retention only shrink on their next refresh while the others fill up to retention.
func ExceedsFeedItemBudget(storedCounts []int, retention int) bool {
	total := 0
	for _, count := range storedCounts {
		total += max(count, retention)
		if total > FeedItemBudget {
			return true
		}
	}

	return false
}

// ValidateBrowserlessSettings accepts an http/https base URL with a host and
// no userinfo, query, or fragment, returned trimmed without trailing slashes.
// The token is kept untrimmed; blank tokens are dropped (keep stored token).
func ValidateBrowserlessSettings(s BrowserlessSettings) (BrowserlessSettings, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(s.URL), "/")

	parsed, err := url.Parse(trimmed)
	if err != nil || !isBrowserlessBaseURL(parsed) {
		return BrowserlessSettings{}, NewError(ErrInvalidBrowserlessSetting, nil)
	}

	token := s.Token
	if token != nil && strings.TrimSpace(*token) == "" {
		token = nil
	}

	return BrowserlessSettings{URL: trimmed, Token: token, ResidentialProxy: s.ResidentialProxy}, nil
}

func isBrowserlessBaseURL(parsed *url.URL) bool {
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return false
	}

	return parsed.Hostname() != "" && parsed.User == nil && parsed.RawQuery == "" && !parsed.ForceQuery && parsed.Fragment == ""
}

func ValidateSMTPSettings(s SMTPSettings) (SMTPSettings, error) {
	senderEmail := strings.TrimSpace(s.SenderEmail)
	if !isValidEmail(senderEmail) {
		return SMTPSettings{}, NewError(ErrInvalidSMTPSetting, nil)
	}

	host := strings.TrimSpace(s.Host)
	if host == "" || s.Port < 1 || s.Port > 65535 {
		return SMTPSettings{}, NewError(ErrInvalidSMTPSetting, nil)
	}

	if s.Security != SMTPSecurityTLS && s.Security != SMTPSecuritySTARTTLS {
		return SMTPSettings{}, NewError(ErrInvalidSMTPSetting, nil)
	}

	settings := s
	settings.SenderEmail = senderEmail
	settings.Host = host
	settings.User = trimOptional(s.User)

	return settings, nil
}

func ValidateKindleSettings(k KindleSettings) (KindleSettings, error) {
	kindleEmail := strings.TrimSpace(k.KindleEmail)
	if !isValidEmail(kindleEmail) {
		return KindleSettings{}, NewError(ErrInvalidKindleSetting, nil)
	}

	if err := ValidateKindleLanguage(k.Language); err != nil {
		return KindleSettings{}, err
	}

	settings := KindleSettings{KindleEmail: kindleEmail, Language: k.Language}
	if k.Schedule == nil {
		return settings, nil
	}

	schedule, err := ValidateKindleSchedule(*k.Schedule)
	if err != nil {
		return KindleSettings{}, err
	}

	settings.Schedule = &schedule

	return settings, nil
}

func ValidateKindleLanguage(language KindleLanguage) error {
	switch language {
	case KindleLanguageChinese, KindleLanguageEnglish, KindleLanguageJapanese:
		return nil
	}

	return NewError(ErrInvalidKindleSetting, nil)
}

func ValidateKindleSchedule(s KindleSchedule) (KindleSchedule, error) {
	validHour := s.Hour >= 0 && s.Hour <= 23
	validMinute := s.Minute >= 0 && s.Minute <= 55 && s.Minute%5 == 0
	if !validHour || !validMinute {
		return KindleSchedule{}, NewError(ErrInvalidKindleSetting, nil)
	}

	s.Timezone = strings.TrimSpace(s.Timezone)
	if _, err := LoadKindleLocation(s.Timezone); err != nil {
		return KindleSchedule{}, err
	}

	return s, nil
}

func trimOptional(value *string) *string {
	if value == nil {
		return nil
	}

	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}

	return &trimmed
}

func isValidEmail(raw string) bool {
	if raw == "" || strings.ContainsAny(raw, " \t\r\n") {
		return false
	}

	addr, err := mail.ParseAddress(raw)
	if err != nil || addr.Name != "" || addr.Address != raw {
		return false
	}

	idx := strings.LastIndex(raw, "@")
	if idx <= 0 || idx == len(raw)-1 {
		return false
	}

	host := raw[idx+1:]

	return isValidEmailHost(host)
}

func isValidEmailHost(host string) bool {
	if host == "" || len(host) > 253 {
		return false
	}

	for _, label := range strings.Split(host, ".") {
		if !isValidHostLabel(label) {
			return false
		}
	}

	return true
}

func isValidHostLabel(label string) bool {
	if label == "" || len(label) > 63 {
		return false
	}

	if label[0] == '-' || label[len(label)-1] == '-' {
		return false
	}

	for i := 0; i < len(label); i++ {
		if !isHostLabelChar(label[i]) {
			return false
		}
	}

	return true
}

func isHostLabelChar(ch byte) bool {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '-'
}
