package domain

import (
	"errors"
	"net/url"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

var (
	credentialPattern = regexp.MustCompile(`(?i)(https?://)[^/\s?#"']+@`)

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
	hasPass := false
	if hasCreds {
		username = parsed.User.Username()
		password, hasPass = parsed.User.Password()
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
		hasPass:  hasPass,
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

	return credentialPattern.ReplaceAllString(msg, "$1")
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

	segments := strings.Split(rawQuery, "&")
	kept := make([]string, 0, len(segments))
	for _, segment := range segments {
		if segment == "" {
			continue
		}

		key := segment
		if idx := strings.Index(segment, "="); idx >= 0 {
			key = segment[:idx]
		}

		if decoded, unescapeErr := url.QueryUnescape(key); unescapeErr == nil {
			key = decoded
		}

		if isTrackingQueryKey(key) {
			continue
		}

		kept = append(kept, segment)
	}

	return strings.Join(kept, "&")
}

func isTrackingQueryKey(key string) bool {
	lower := strings.ToLower(key)
	if strings.HasPrefix(lower, "utm_") {
		return true
	}

	_, tracked := trackingQueryKeys[lower]

	return tracked
}
