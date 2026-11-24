package domain

import (
	"errors"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

var (
	trackingQueryKeys = map[string]struct{}{
		"gclid":     {},
		"dclid":     {},
		"gbraid":    {},
		"wbraid":    {},
		"fbclid":    {},
		"msclkid":   {},
		"yclid":     {},
		"twclid":    {},
		"ttclid":    {},
		"li_fat_id": {},
		"igshid":    {},
		"mc_cid":    {},
		"mc_eid":    {},
		"_hsenc":    {},
		"_hsmi":     {},
		"mkt_tok":   {},
		"_ga":       {},
		"_gl":       {},
	}
)

func NewID() string {
	id, err := uuid.NewV7()
	if err != nil {
		panic(err)
	}

	return id.String()
}

func IsValidUUIDv7(s string) bool {
	if len(s) != 36 {
		return false
	}

	u, err := uuid.Parse(s)
	if err != nil {
		return false
	}

	return u.Version() == 7 && u.Variant() == uuid.RFC4122 && u.String() == s
}

func ParseNormalizedURL(raw string, invalidCode ErrorCode) (NormalizedURL, error) {
	parsed, host, err := parseHTTPURL(raw, invalidCode)
	if err != nil {
		return NormalizedURL{}, err
	}

	return buildNormalizedURL(parsed, host), nil
}

func parseHTTPURL(raw string, invalidCode ErrorCode) (*url.URL, string, error) {
	trimmed := strings.TrimSpace(raw)
	if strings.ContainsAny(trimmed, " \t\r\n") {
		return nil, "", NewError(invalidCode, errors.New("invalid url"))
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, "", NewError(invalidCode, errors.New("invalid url"))
	}

	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, "", NewError(invalidCode, nil)
	}

	host := strings.ToLower(parsed.Hostname())
	if host == "" {
		return nil, "", NewError(invalidCode, nil)
	}

	parsed.Scheme = scheme
	parsed.Host = buildHost(host, parsed.Port(), scheme)

	return parsed, host, nil
}

func buildNormalizedURL(parsed *url.URL, host string) NormalizedURL {
	parsed.Fragment = ""
	parsed.RawFragment = ""
	parsed.RawQuery = stripTrackingQuery(parsed.RawQuery)
	if parsed.RawQuery == "" {
		parsed.ForceQuery = false
	}

	if parsed.Path == "" {
		parsed.Path = "/"
	}

	hasCreds := parsed.User != nil
	username := ""
	password := ""
	if hasCreds {
		username = parsed.User.Username()
		password, _ = parsed.User.Password()
	}

	rawURL := parsed.String()
	parsed.User = nil
	redacted := parsed.String()

	return NormalizedURL{
		raw:      rawURL,
		redacted: redacted,
		host:     host,
		hasCreds: hasCreds,
		username: username,
		password: password,
	}
}

// Origin is a comparable (scheme, host, effective port) tuple for URL origin checks.
type Origin struct {
	Scheme string
	Host   string
	Port   string
}

// OriginFromURL extracts a normalized, comparable Origin from parsed.
func OriginFromURL(parsed *url.URL) (Origin, bool) {
	if parsed == nil {
		return Origin{}, false
	}

	scheme := strings.ToLower(parsed.Scheme)
	host := strings.ToLower(parsed.Hostname())
	if scheme == "" || host == "" {
		return Origin{}, false
	}

	port := parsed.Port()
	if port == "" {
		switch scheme {
		case "http":
			port = "80"
		case "https":
			port = "443"
		}
	}

	return Origin{Scheme: scheme, Host: host, Port: port}, true
}

func ParseStoredNormalizedURL(raw string) (NormalizedURL, error) {
	return ParseNormalizedURL(raw, ErrFeedUrlInvalid)
}

func SanitizeErrorText(msg string) string {
	if msg == "" {
		return ""
	}

	redacted := redactEmbeddedURLs(msg)
	if whole, ok := redactWholeURL(redacted); ok {
		return whole
	}

	return redacted
}

func redactWholeURL(raw string) (string, bool) {
	if strings.IndexFunc(raw, unicode.IsSpace) >= 0 {
		return "", false
	}

	parsed, err := url.Parse(raw)
	if err != nil || parsed.User == nil || parsed.Host == "" {
		return "", false
	}

	switch strings.ToLower(parsed.Scheme) {
	case "http", "https", "ws", "wss":
	default:
		return "", false
	}

	schemeLen := len(parsed.Scheme)
	parsed.User = nil
	formatted := parsed.String()
	if len(formatted) >= schemeLen && strings.EqualFold(formatted[:schemeLen], raw[:schemeLen]) {
		formatted = raw[:schemeLen] + formatted[schemeLen:]
	}

	return formatted, true
}

func redactEmbeddedURLs(msg string) string {
	var builder strings.Builder
	written := 0
	pos := 0

	for pos < len(msg) {
		authStart, ok := findSchemeAuthority(msg, pos)
		if !ok {
			break
		}

		authEnd := scanAuthorityEnd(msg, authStart)
		if lastAt := strings.LastIndexByte(msg[authStart:authEnd], '@'); lastAt >= 0 {
			builder.WriteString(msg[written:authStart])
			written = authStart + lastAt + 1
		}

		pos = authEnd
	}

	if written == 0 {
		return msg
	}

	builder.WriteString(msg[written:])

	return builder.String()
}

func findSchemeAuthority(s string, from int) (int, bool) {
	pos := from
	for pos < len(s) {
		rel := strings.Index(s[pos:], "://")
		if rel < 0 {
			return 0, false
		}

		sep := pos + rel
		if matchSupportedScheme(s, sep) {
			return sep + 3, true
		}

		pos = sep + 3
	}

	return 0, false
}

func matchSupportedScheme(s string, sep int) bool {
	var start int
	switch {
	case sep >= 5 && strings.EqualFold(s[sep-5:sep], "https"):
		start = sep - 5
	case sep >= 4 && strings.EqualFold(s[sep-4:sep], "http"):
		start = sep - 4
	case sep >= 3 && strings.EqualFold(s[sep-3:sep], "wss"):
		start = sep - 3
	case sep >= 2 && strings.EqualFold(s[sep-2:sep], "ws"):
		start = sep - 2
	default:
		return false
	}

	return start == 0 || !isSchemeChar(s[start-1])
}

func isSchemeChar(b byte) bool {
	return (b >= 'a' && b <= 'z') ||
		(b >= 'A' && b <= 'Z') ||
		(b >= '0' && b <= '9') ||
		b == '+' || b == '-' || b == '.'
}

func scanAuthorityEnd(s string, start int) int {
	for i := start; i < len(s); {
		b := s[i]
		if b < utf8.RuneSelf {
			if isAuthorityDelimiter(b) {
				return i
			}

			i++
			continue
		}

		r, size := utf8.DecodeRuneInString(s[i:])
		if unicode.IsSpace(r) {
			return i
		}

		i += size
	}

	return len(s)
}

func isAuthorityDelimiter(b byte) bool {
	switch b {
	case '/', '?', '#', '"', '`', ')', ']', '>', '}', ' ', '\t', '\r', '\n', '\v', '\f':
		return true
	default:
		return false
	}
}

func buildHost(host string, port string, scheme string) string {
	if port != "" && ((scheme == "http" && port == "80") || (scheme == "https" && port == "443")) {
		port = ""
	}

	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}

	if port == "" {
		return host
	}

	return host + ":" + port
}

func stripTrackingQuery(rawQuery string) string {
	if rawQuery == "" {
		return ""
	}

	var builder strings.Builder
	for segment := range strings.SplitSeq(rawQuery, "&") {
		if segment == "" || isTrackingQueryKey(querySegmentKey(segment)) {
			continue
		}

		if builder.Len() > 0 {
			builder.WriteByte('&')
		}

		builder.WriteString(segment)
	}

	return builder.String()
}

func querySegmentKey(segment string) string {
	key := segment
	if idx := strings.IndexByte(segment, '='); idx >= 0 {
		key = segment[:idx]
	}

	if decoded, unescapeErr := url.QueryUnescape(key); unescapeErr == nil {
		return decoded
	}

	return key
}

func isTrackingQueryKey(key string) bool {
	lower := strings.ToLower(key)
	if strings.HasPrefix(lower, "utm_") {
		return true
	}

	_, tracked := trackingQueryKeys[lower]

	return tracked
}
