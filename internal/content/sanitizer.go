package content

import (
	"bytes"
	"fmt"
	"net/url"
	"regexp"
	"strings"

	"github.com/microcosm-cc/bluemonday"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"reader/internal/domain"
)

var loadingAttribute = regexp.MustCompile(`(?i)^(auto|eager|lazy)$`)

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
	if strings.TrimSpace(rawHTML) == "" {
		return "", nil
	}

	nodes, err := html.ParseFragment(strings.NewReader(rawHTML), fragmentContainer())
	if err != nil {
		return "", sanitizerError(err)
	}

	redactedBaseURL := publicBaseURL(baseURL)

	for _, node := range nodes {
		rewriteURLs(node, redactedBaseURL)
	}

	var rendered bytes.Buffer

	for _, node := range nodes {
		if err := html.Render(&rendered, node); err != nil {
			return "", sanitizerError(err)
		}
	}

	return strings.TrimSpace(s.policy.Sanitize(rendered.String())), nil
}

func fragmentContainer() *html.Node {
	return &html.Node{Type: html.ElementNode, Data: "div", DataAtom: atom.Div}
}

func rewriteURLs(node *html.Node, baseURL string) {
	if node.Type == html.ElementNode {
		switch node.Data {
		case "a":
			rewriteLink(node, baseURL)
		case "img":
			rewriteMediaSource(node, baseURL, true)
		case "source", "video", "audio":
			rewriteMediaSource(node, baseURL, false)
		}
	}

	for child := node.FirstChild; child != nil; child = child.NextSibling {
		rewriteURLs(child, baseURL)
	}
}

func rewriteLink(node *html.Node, baseURL string) {
	href, ok := attributeValue(node, "href")
	if !ok {
		return
	}

	resolved := resolvePublicURL(baseURL, href)
	if !isAllowedLinkURL(resolved) {
		removeAttribute(node, "href")

		return
	}

	setAttribute(node, "href", resolved)
	setAttribute(node, "target", "_blank")
	setAttribute(node, "rel", "noopener noreferrer")
}

func rewriteMediaSource(node *html.Node, baseURL string, allowDataImage bool) {
	src, ok := attributeValue(node, "src")
	if !ok {
		return
	}

	resolved := resolvePublicURL(baseURL, src)
	if !isAllowedMediaURL(resolved, allowDataImage) {
		removeAttribute(node, "src")

		return
	}

	setAttribute(node, "src", resolved)
}

func isAllowedLinkURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}

	switch strings.ToLower(parsed.Scheme) {
	case "http", "https", "mailto":
		return true
	}

	return false
}

func isAllowedMediaURL(rawURL string, allowDataImage bool) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
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

func resolveURL(baseURL string, rawURL string) (*url.URL, bool) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return nil, false
	}

	reference, err := url.Parse(trimmed)
	if err != nil {
		return nil, false
	}

	base, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return reference, true
	}

	return base.ResolveReference(reference), true
}

func resolvePublicURL(baseURL string, rawURL string) string {
	resolved, ok := resolveURL(baseURL, rawURL)
	if !ok {
		return ""
	}

	return publicURLString(resolved)
}

func publicBaseURL(baseURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return baseURL
	}

	return publicURLString(parsed)
}

func publicURLString(parsed *url.URL) string {
	if parsed == nil {
		return ""
	}

	redactURLCredentials(parsed)

	return parsed.String()
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

func setAttribute(node *html.Node, key string, value string) {
	for index := range node.Attr {
		if node.Attr[index].Key == key {
			node.Attr[index].Val = value

			return
		}
	}

	node.Attr = append(node.Attr, html.Attribute{Key: key, Val: value})
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
