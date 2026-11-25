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
	linkHrefAttribute     = regexp.MustCompile(`(?i)^(https?://|mailto:)`)
	mediaSrcAttribute     = regexp.MustCompile(`(?i)^https?://`)
	imageSrcAttribute     = regexp.MustCompile(`(?i)^(https?://|data:image/)`)
	openAttribute         = regexp.MustCompile(`(?i)^(|open)$`)
	targetBlankAttribute  = regexp.MustCompile(`^_blank$`)
	errHTMLBudgetExceeded = errors.New("sanitized html exceeds byte budget")
)

type Sanitizer struct {
	policy *bluemonday.Policy
}

func NewSanitizer() *Sanitizer {
	return &Sanitizer{policy: buildHTMLPolicy()}
}

func buildHTMLPolicy() *bluemonday.Policy {
	policy := bluemonday.NewPolicy()
	policy.AllowStandardAttributes()
	policy.RequireParseableURLs(true)
	policy.AllowURLSchemes("mailto", "http", "https")
	policy.AllowURLSchemeWithCustomPolicy("data", isImageDataURL)

	allowContentElements(policy)
	allowMediaElements(policy)
	allowLinkElements(policy)

	return policy
}

func allowContentElements(policy *bluemonday.Policy) {
	policy.AllowElements(
		"article", "aside", "figure", "figcaption", "section", "summary",
		"h1", "h2", "h3", "h4", "h5", "h6", "hgroup",
		"blockquote", "br", "div", "hr", "p", "span", "wbr",
		"abbr", "acronym", "cite", "code", "dfn", "em", "mark", "q",
		"s", "samp", "strong", "sub", "sup", "var",
		"b", "i", "pre", "small", "strike", "tt", "u",
		"del", "ins", "rp", "rt", "ruby",
	)
	policy.AllowAttrs("open").Matching(openAttribute).OnElements("details")
	policy.AllowAttrs("datetime").Matching(bluemonday.ISO8601).OnElements("time", "del", "ins")
	policy.AllowAttrs("dir").Matching(bluemonday.Direction).OnElements("bdi", "bdo")
	policy.AllowAttrs("value", "min", "max", "low", "high", "optimum").Matching(bluemonday.Number).OnElements("meter")
	policy.AllowAttrs("value", "max").Matching(bluemonday.Number).OnElements("progress")
	policy.AllowLists()
	policy.AllowTables()
}

func allowMediaElements(policy *bluemonday.Policy) {
	policy.AllowAttrs("align").Matching(bluemonday.ImageAlign).OnElements("img")
	policy.AllowAttrs("alt").Matching(bluemonday.Paragraph).OnElements("img")
	policy.AllowAttrs("height", "width").Matching(bluemonday.NumberOrPercent).OnElements("img")
	policy.AllowAttrs("loading").Matching(loadingAttribute).OnElements("img")
	policy.AllowAttrs("src").Matching(imageSrcAttribute).OnElements("img")

	policy.AllowElements("picture")
	policy.AllowAttrs("type", "media").OnElements("source")
	policy.AllowAttrs("src").Matching(mediaSrcAttribute).OnElements("source", "video", "audio")
	policy.AllowAttrs("controls", "loop", "muted", "autoplay", "playsinline").OnElements("video", "audio")
}

func allowLinkElements(policy *bluemonday.Policy) {
	policy.AllowAttrs("href").Matching(linkHrefAttribute).OnElements("a")
	policy.AllowAttrs("target").Matching(targetBlankAttribute).OnElements("a")
	policy.AllowAttrs("rel").Matching(bluemonday.SpaceSeparatedTokens).OnElements("a")
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

	if err := rewriteFragmentURLs(nodes, parsePublicBaseURL(baseURL), maxBytes-len(rawHTML)); err != nil {
		return "", err
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

func rewriteFragmentURLs(nodes []*html.Node, base *url.URL, remaining int) error {
	budget := byteBudget{remaining: remaining}

	for _, node := range nodes {
		if !rewriteURLs(node, base, &budget) {
			return sanitizerError(errHTMLBudgetExceeded)
		}
	}

	return nil
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

type byteBudget struct {
	remaining int
}

func (b *byteBudget) consume(delta int) bool {
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

func rewriteURLs(node *html.Node, base *url.URL, budget *byteBudget) bool {
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

func rewriteElementURL(node *html.Node, base *url.URL, budget *byteBudget) bool {
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

func rewriteLink(node *html.Node, base *url.URL, budget *byteBudget) bool {
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

func rewriteMediaSource(node *html.Node, base *url.URL, allowDataImage bool, budget *byteBudget) bool {
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
	case "http", "https":
		return true
	case "mailto":
		return parsed.User == nil && parsed.Host == ""
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
	if parsed != nil {
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

func setAttributeBudgeted(node *html.Node, key string, value string, budget *byteBudget) bool {
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
	if errors.Is(err, errHTMLBudgetExceeded) {
		return fmt.Errorf("html sanitizer: %w", errHTMLBudgetExceeded)
	}

	return fmt.Errorf("html sanitizer: %s", domain.SanitizeErrorText(err.Error()))
}
