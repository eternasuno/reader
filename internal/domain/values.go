package domain

import (
	"net/mail"
	"net/url"
	"strings"
)

const (
	defaultPageLimit = 30
	maxPageLimit     = 200
)

func ValidatePageParams(limit int, hasLimit bool, unread bool, order SortOrder, cursor *string, boundary *string) (PageParams, error) {
	if !hasLimit {
		limit = defaultPageLimit
	}

	if limit < 1 || limit > maxPageLimit {
		return PageParams{}, NewError(ErrRequestFailed, nil)
	}

	if order == "" {
		order = SortOrderNewest
	}

	if err := ValidateSortOrder(order); err != nil {
		return PageParams{}, NewError(ErrRequestFailed, nil)
	}

	resolvedBoundary, err := resolvePageBoundary(cursor, boundary)
	if err != nil {
		return PageParams{}, err
	}

	return PageParams{
		Limit:    limit,
		Unread:   unread,
		Order:    order,
		Cursor:   cursor,
		Boundary: resolvedBoundary,
	}, nil
}

func resolvePageBoundary(cursor *string, boundary *string) (string, error) {
	if cursor == nil {
		if boundary != nil {
			return "", NewError(ErrRequestFailed, nil)
		}

		return NewID(), nil
	}

	if !IsValidUUIDv7(*cursor) || boundary == nil || !IsValidUUIDv7(*boundary) {
		return "", NewError(ErrRequestFailed, nil)
	}

	return *boundary, nil
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
	if n < 1 {
		return NewError(ErrInvalidRetention, nil)
	}

	return nil
}

func ValidateProvider(p ExtractorProvider) error {
	switch p {
	case ProviderDirect, ProviderJina, ProviderBrowser:
		return nil
	}

	return NewError(ErrInvalidProvider, nil)
}

func ValidateJinaKey(raw string) (string, error) {
	key := strings.TrimSpace(raw)
	if key == "" {
		return "", NewError(ErrInvalidJinaKey, nil)
	}

	return key, nil
}

func ValidateBrowserEndpoint(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", NewError(ErrInvalidEndpoint, nil)
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", NewError(ErrInvalidEndpoint, nil)
	}

	switch strings.ToLower(parsed.Scheme) {
	case "http", "https", "ws", "wss":
	default:
		return "", NewError(ErrInvalidEndpoint, nil)
	}

	if parsed.Hostname() == "" {
		return "", NewError(ErrInvalidEndpoint, nil)
	}

	return trimmed, nil
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
