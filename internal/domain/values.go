package domain

import (
	"net/mail"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	defaultPageLimit = 30
	maxPageLimit     = 200
)

var sendTimePattern = regexp.MustCompile(`^([01][0-9]|2[0-3]):(00|30)$`)

func ValidatePageParams(limit int, hasLimit bool, unread bool, order SortOrder, cursor *string) (PageParams, error) {
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

	pageCursor := cursor
	if cursor != nil && !IsValidUUIDv7(*cursor) {
		return PageParams{}, NewError(ErrRequestFailed, nil)
	}

	return PageParams{
		Limit:  limit,
		Unread: unread,
		Order:  order,
		Cursor: pageCursor,
	}, nil
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
	case ReaderModeDefault, ReaderModeExtracted, ReaderModeEmbedded:
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

func ValidateSendTime(raw string) (int, int, error) {
	match := sendTimePattern.FindStringSubmatch(strings.TrimSpace(raw))
	if match == nil {
		return 0, 0, NewError(ErrInvalidKindleSetting, nil)
	}

	hour, err := strconv.Atoi(match[1])
	if err != nil {
		return 0, 0, NewError(ErrInvalidKindleSetting, err)
	}

	minute, err := strconv.Atoi(match[2])
	if err != nil {
		return 0, 0, NewError(ErrInvalidKindleSetting, err)
	}

	return hour, minute, nil
}

func ComputeNextSendAt(sendTime string, now time.Time, loc *time.Location) (time.Time, error) {
	hour, minute, err := ValidateSendTime(sendTime)
	if err != nil {
		return time.Time{}, err
	}

	if loc == nil {
		loc = time.UTC
	}

	local := now.In(loc)
	baseDate := time.Date(local.Year(), local.Month(), local.Day(), 12, 0, 0, 0, loc)
	for dayOffset := 0; dayOffset < 8; dayOffset++ {
		target := baseDate.AddDate(0, 0, dayOffset)
		if candidate, ok := candidateSendTimeForDay(target, hour, minute, now, loc); ok {
			return candidate, nil
		}
	}

	return time.Time{}, NewError(ErrInvalidKindleSetting, nil)
}

func candidateSendTimeForDay(target time.Time, hour int, minute int, now time.Time, loc *time.Location) (time.Time, bool) {
	baseCandidate := time.Date(target.Year(), target.Month(), target.Day(), hour, minute, 0, 0, loc)
	for _, delta := range sendTimeDeltas(dstShift(baseCandidate)) {
		candidate := baseCandidate.Add(delta).In(loc)
		if isMatchingLocalTime(candidate, target, hour, minute) && candidate.After(now) {
			return candidate.UTC(), true
		}
	}

	return time.Time{}, false
}

func dstShift(baseCandidate time.Time) time.Duration {
	_, beforeOff := baseCandidate.Add(-3 * time.Hour).Zone()
	_, afterOff := baseCandidate.Add(3 * time.Hour).Zone()
	shift := time.Duration(beforeOff-afterOff) * time.Second
	if shift < 0 {
		return -shift
	}

	return shift
}

func sendTimeDeltas(shift time.Duration) []time.Duration {
	if shift <= 0 {
		return []time.Duration{0}
	}

	return []time.Duration{-shift, 0, shift}
}

func isMatchingLocalTime(candidate time.Time, target time.Time, hour int, minute int) bool {
	if candidate.Year() != target.Year() || candidate.Month() != target.Month() || candidate.Day() != target.Day() {
		return false
	}

	return candidate.Hour() == hour && candidate.Minute() == minute
}

func ValidateKindleSettings(k KindleSettings, now time.Time, loc *time.Location) (KindleSettings, error) {
	kindleEmail := strings.TrimSpace(k.KindleEmail)
	if !isValidEmail(kindleEmail) {
		return KindleSettings{}, NewError(ErrInvalidKindleSetting, nil)
	}

	senderEmail := strings.TrimSpace(k.SenderEmail)
	if !isValidEmail(senderEmail) {
		return KindleSettings{}, NewError(ErrInvalidKindleSetting, nil)
	}

	smtpHost, err := validateSMTPSettings(k)
	if err != nil {
		return KindleSettings{}, err
	}

	sendTime, nextSendAt, err := resolveKindleSchedule(k.SendTime, now, loc)
	if err != nil {
		return KindleSettings{}, err
	}

	settings := k
	settings.KindleEmail = kindleEmail
	settings.SenderEmail = senderEmail
	settings.SMTPHost = smtpHost
	settings.SendTime = sendTime
	settings.NextSendAt = nextSendAt

	return settings, nil
}

func validateSMTPSettings(k KindleSettings) (string, error) {
	smtpHost := strings.TrimSpace(k.SMTPHost)
	if smtpHost == "" || k.SMTPPort < 1 || k.SMTPPort > 65535 {
		return "", NewError(ErrInvalidKindleSetting, nil)
	}

	if k.SMTPSecurity != SMTPSecurityTLS && k.SMTPSecurity != SMTPSecuritySTARTTLS {
		return "", NewError(ErrInvalidKindleSetting, nil)
	}

	return smtpHost, nil
}

func resolveKindleSchedule(rawSendTime *string, now time.Time, loc *time.Location) (*string, *time.Time, error) {
	if rawSendTime == nil || strings.TrimSpace(*rawSendTime) == "" {
		return nil, nil, nil
	}

	trimmed := strings.TrimSpace(*rawSendTime)
	nextSendAt, err := ComputeNextSendAt(trimmed, now, loc)
	if err != nil {
		return nil, nil, NewError(ErrInvalidKindleSetting, nil)
	}

	return &trimmed, &nextSendAt, nil
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
