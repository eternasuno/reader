package content

import (
	"bytes"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/microcosm-cc/bluemonday"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"reader/internal/domain"
)

// maxSanitizedHTMLBytes caps serialized/sanitized HTML at 4x the 10 MiB fetch
// limit so relative-URL expansion cannot balloon memory per entry.
const maxSanitizedHTMLBytes = 40 << 20

var (
	loadingAttribute      = regexp.MustCompile(`(?i)^(auto|eager|lazy)$`)
	errHTMLBudgetExceeded = errors.New("sanitized html exceeds byte budget")
)

type Sanitizer struct {
	policy *bluemonday.Policy
}

func NewSanitizer() *Sanitizer {
	policy := bluemonday.UGCPolicy()
	policy.RequireNoFollowOnLinks(false)
	policy.AllowURLSchemeWithCustomPolicy("data", isImageDataURL)

	policy.AllowElements("picture", "source", "video", "audio")
	policy.AllowAttrs("target").Matching(regexp.MustCompile(`^_blank$`)).OnElements("a")
	policy.AllowAttrs("rel").Matching(bluemonday.SpaceSeparatedTokens).OnElements("a")
	policy.AllowAttrs("loading").Matching(loadingAttribute).OnElements("img")
	policy.AllowAttrs("type", "media").OnElements("source")
	policy.AllowAttrs("src").OnElements("source", "video", "audio")
	policy.AllowAttrs("controls", "loop", "muted", "autoplay", "playsinline").OnElements("video", "audio")

	return &Sanitizer{policy: policy}
}

func (s *Sanitizer) SanitizeHTML(rawHTML string, baseURL string) (string, error) {
	return s.sanitizeHTMLWithBudget(rawHTML, baseURL, maxSanitizedHTMLBytes)
}

func (s *Sanitizer) sanitizeHTMLWithBudget(rawHTML string, baseURL string, maxBytes int) (string, error) {
	if strings.TrimSpace(rawHTML) == "" {
		return "", nil
	}

	if len(rawHTML) > maxBytes {
		return "", sanitizerError(errHTMLBudgetExceeded)
	}

	nodes, err := html.ParseFragment(strings.NewReader(rawHTML), fragmentContainer())
	if err != nil {
		return "", sanitizerError(err)
	}

	base := parsePublicBaseURL(baseURL)
	budget := rewriteBudget{remaining: maxBytes - len(rawHTML)}

	for _, node := range nodes {
		if !rewriteURLs(node, base, &budget) {
			return "", sanitizerError(errHTMLBudgetExceeded)
		}
	}

	rendered := boundedBuffer{limit: maxBytes}
	for _, node := range nodes {
		if err := html.Render(&rendered, node); err != nil {
			return "", sanitizerError(err)
		}
	}

	// Only bluemonday enforces the element/attribute allowlist, so keep this
	// single strict sanitization pass on the bounded tree output.
	sanitized := boundedBuffer{limit: maxBytes}
	if err := s.policy.SanitizeReaderToWriter(bytes.NewReader(rendered.buf.Bytes()), &sanitized); err != nil {
		return "", sanitizerError(err)
	}

	return strings.TrimSpace(sanitized.buf.String()), nil
}

type boundedBuffer struct {
	buf   bytes.Buffer
	limit int
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.buf.Len() {
		return 0, errHTMLBudgetExceeded
	}

	return b.buf.Write(p)
}

type rewriteBudget struct {
	remaining int
}

func (b *rewriteBudget) consume(delta int) bool {
	if delta <= 0 {
		return true
	}

	if delta > b.remaining {
		b.remaining = -1

		return false
	}

	b.remaining -= delta

	return true
}

func fragmentContainer() *html.Node {
	return &html.Node{Type: html.ElementNode, Data: "div", DataAtom: atom.Div}
}

func rewriteURLs(node *html.Node, base *url.URL, budget *rewriteBudget) bool {
	if node.Type == html.ElementNode && !rewriteElementURL(node, base, budget) {
		return false
	}

	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if !rewriteURLs(child, base, budget) {
			return false
		}
	}

	return true
}

func rewriteElementURL(node *html.Node, base *url.URL, budget *rewriteBudget) bool {
	switch node.Data {
	case "a":
		return rewriteLink(node, base, budget)
	case "img":
		return rewriteMediaSource(node, base, true, budget)
	case "source", "video", "audio":
		return rewriteMediaSource(node, base, false, budget)
	default:
		return true
	}
}

func rewriteLink(node *html.Node, base *url.URL, budget *rewriteBudget) bool {
	href, ok := attributeValue(node, "href")
	if !ok {
		return true
	}

	resolved, ok := resolvePublicURL(base, href)
	if !ok || !isAllowedLinkURL(resolved) {
		removeAttribute(node, "href")

		return true
	}

	return setAttributeBudgeted(node, "href", resolved.String(), budget) &&
		setAttributeBudgeted(node, "target", "_blank", budget) &&
		setAttributeBudgeted(node, "rel", "noopener noreferrer", budget)
}

func rewriteMediaSource(node *html.Node, base *url.URL, allowDataImage bool, budget *rewriteBudget) bool {
	src, ok := attributeValue(node, "src")
	if !ok {
		return true
	}

	resolved, ok := resolvePublicURL(base, src)
	if !ok || !isAllowedMediaURL(resolved, allowDataImage) {
		removeAttribute(node, "src")

		return true
	}

	return setAttributeBudgeted(node, "src", resolved.String(), budget)
}

func isAllowedLinkURL(parsed *url.URL) bool {
	if parsed == nil {
		return false
	}

	switch strings.ToLower(parsed.Scheme) {
	case "http", "https", "mailto":
		return true
	}

	return false
}

func isAllowedMediaURL(parsed *url.URL, allowDataImage bool) bool {
	if parsed == nil {
		return false
	}

	switch strings.ToLower(parsed.Scheme) {
	case "http", "https":
		return true
	case "data":
		return allowDataImage && isImageDataURL(parsed)
	}

	return false
}

func isImageDataURL(parsed *url.URL) bool {
	if parsed == nil || !strings.EqualFold(parsed.Scheme, "data") {
		return false
	}

	return strings.HasPrefix(strings.ToLower(parsed.Opaque), "image/")
}

func parseBaseURL(baseURL string) *url.URL {
	trimmed := strings.TrimSpace(baseURL)
	if trimmed == "" {
		return nil
	}

	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil
	}

	return parsed
}

func parsePublicBaseURL(baseURL string) *url.URL {
	parsed := parseBaseURL(baseURL)
	if parsed == nil {
		return nil
	}

	redactURLCredentials(parsed)

	return parsed
}

func resolveWithBase(base *url.URL, rawURL string) (*url.URL, bool) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return nil, false
	}

	reference, err := url.Parse(trimmed)
	if err != nil {
		return nil, false
	}

	if base == nil {
		return reference, true
	}

	return base.ResolveReference(reference), true
}

func resolvePublicURL(base *url.URL, rawURL string) (*url.URL, bool) {
	resolved, ok := resolveWithBase(base, rawURL)
	if !ok {
		return nil, false
	}

	redactURLCredentials(resolved)

	return resolved, true
}

func redactURLCredentials(parsed *url.URL) {
	switch strings.ToLower(parsed.Scheme) {
	case "http", "https":
		parsed.User = nil
	}
}

func attributeValue(node *html.Node, key string) (string, bool) {
	for _, attr := range node.Attr {
		if attr.Key == key {
			return attr.Val, true
		}
	}

	return "", false
}

func setAttributeBudgeted(node *html.Node, key string, value string, budget *rewriteBudget) bool {
	for index := range node.Attr {
		if node.Attr[index].Key == key {
			if !budget.consume(len(value) - len(node.Attr[index].Val)) {
				return false
			}

			node.Attr[index].Val = value

			return true
		}
	}

	// Count ` key="value"` syntax overhead for newly added attributes.
	if !budget.consume(len(key) + len(value) + 4) {
		return false
	}

	node.Attr = append(node.Attr, html.Attribute{Key: key, Val: value})

	return true
}

func removeAttribute(node *html.Node, key string) {
	kept := make([]html.Attribute, 0, len(node.Attr))

	for _, attr := range node.Attr {
		if attr.Key != key {
			kept = append(kept, attr)
		}
	}

	node.Attr = kept
}

func sanitizerError(err error) error {
	return fmt.Errorf("html sanitizer: %s", domain.SanitizeErrorText(err.Error()))
}
