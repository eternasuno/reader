package epub

import (
	"fmt"
	"net/url"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"reader/internal/domain"
)

var voidElements = map[string]struct{}{
	"area":   {},
	"base":   {},
	"br":     {},
	"col":    {},
	"embed":  {},
	"hr":     {},
	"img":    {},
	"input":  {},
	"link":   {},
	"meta":   {},
	"param":  {},
	"source": {},
	"track":  {},
	"wbr":    {},
}

// chapterInput is an immutable parsed article and its resolved image targets.
type chapterInput struct {
	article  domain.KindleArticle
	root     *html.Node
	nodeURLs map[*html.Node]string
	imgURLs  []string
}

func newChapterInput(article domain.KindleArticle) (chapterInput, error) {
	parseCtx := &html.Node{Type: html.ElementNode, Data: "div", DataAtom: atom.Div}
	nodes, err := html.ParseFragment(strings.NewReader(article.HTMLBody), parseCtx)
	if err != nil {
		return chapterInput{}, fmt.Errorf("parse article html: %s", domain.SanitizeErrorText(err.Error()))
	}

	root := &html.Node{Type: html.ElementNode, Data: "div", DataAtom: atom.Div}
	for _, node := range nodes {
		root.AppendChild(node)
	}

	nodeURLs, imgURLs := extractChapterImages(article.URL, root)

	return chapterInput{
		article:  article,
		root:     root,
		nodeURLs: nodeURLs,
		imgURLs:  imgURLs,
	}, nil
}

func extractChapterImages(articleURL string, root *html.Node) (map[*html.Node]string, []string) {
	nodeURLs := make(map[*html.Node]string)
	imgURLs := make([]string, 0)
	seen := make(map[string]struct{})

	walkImageNodes(root, func(node *html.Node) {
		resolved := resolveImageURL(articleURL, nodeAttr(node, "src"))
		if resolved == "" {
			return
		}

		nodeURLs[node] = resolved
		if _, ok := seen[resolved]; ok {
			return
		}

		seen[resolved] = struct{}{}
		imgURLs = append(imgURLs, resolved)
	})

	return nodeURLs, imgURLs
}

func walkImageNodes(parent *html.Node, visit func(*html.Node)) {
	for child := parent.FirstChild; child != nil; child = child.NextSibling {
		if child.Type == html.ElementNode && child.Data == "img" {
			visit(child)
		}

		walkImageNodes(child, visit)
	}
}

func resolveImageURL(baseURL string, rawURL string) string {
	raw := strings.TrimSpace(rawURL)
	if raw == "" {
		return ""
	}

	base, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return ""
	}

	reference, err := url.Parse(raw)
	if err != nil {
		return ""
	}

	resolved := base.ResolveReference(reference)
	if resolved.Scheme != "http" && resolved.Scheme != "https" {
		return ""
	}

	return resolved.String()
}

func nodeAttr(node *html.Node, key string) string {
	for _, attr := range node.Attr {
		if attr.Key == key {
			return attr.Val
		}
	}

	return ""
}

func renderChapter(ch chapterInput, rewrites map[string]string, locale bookLocale) ([]byte, bool) {
	title := chapterTitle(ch.article, locale)

	cw := chapterWriter{
		nodeURLs: ch.nodeURLs,
		rewrites: rewrites,
	}
	cw.out.WriteString(xmlDeclaration)
	cw.out.WriteString("<!DOCTYPE html>\n")
	cw.out.WriteString(locale.htmlOpenTag())
	cw.out.WriteString("<head>\n<title>")
	writeEscapedText(builderXMLWriter{sb: &cw.out}, title)
	cw.out.WriteString("</title>\n<link rel=\"stylesheet\" type=\"text/css\" href=\"../styles.css\"/>\n</head>\n<body>\n<h1>")
	writeEscapedText(builderXMLWriter{sb: &cw.out}, title)
	cw.out.WriteString("</h1>\n")
	writeChapterMeta(&cw.out, ch.article, locale)
	cw.out.WriteString("<div class=\"article-content\">")
	cw.writeChildren(ch.root)
	cw.out.WriteString("</div>\n</body>\n</html>\n")

	return []byte(cw.out.String()), cw.hasRemoteResources
}

type chapterWriter struct {
	out                strings.Builder
	nodeURLs           map[*html.Node]string
	rewrites           map[string]string
	hasRemoteResources bool
}

func writeChapterMeta(out *strings.Builder, article domain.KindleArticle, locale bookLocale) {
	parts := make([]string, 0, 3)

	if sourceTitle := strings.TrimSpace(article.SourceTitle); sourceTitle != "" {
		parts = append(parts, escapeXMLText(sourceTitle))
	}

	if article.PublishedAt != nil {
		parts = append(parts, escapeXMLText(article.PublishedAt.Format("2006-01-02 15:04")))
	}

	if articleURL := strings.TrimSpace(article.URL); articleURL != "" {
		parts = append(parts, "<a href=\""+escapeXMLAttr(articleURL)+"\">"+locale.originalLink+"</a>")
	}

	if len(parts) == 0 {
		return
	}

	out.WriteString("<p class=\"article-meta\">" + strings.Join(parts, " · ") + "</p>\n")
}

func chapterTitle(article domain.KindleArticle, locale bookLocale) string {
	if title := strings.TrimSpace(article.Title); title != "" {
		return title
	}

	return locale.untitled
}

func (cw *chapterWriter) writeChildren(parent *html.Node) {
	for child := parent.FirstChild; child != nil; child = child.NextSibling {
		cw.writeNode(child)
	}
}

func (cw *chapterWriter) writeNode(node *html.Node) {
	switch node.Type {
	case html.TextNode:
		writeEscapedText(builderXMLWriter{sb: &cw.out}, node.Data)
	case html.ElementNode:
		cw.writeElement(node)
	}
}

func (cw *chapterWriter) writeElement(node *html.Node) {
	if node.Data == "img" {
		cw.writeImageElement(node)

		return
	}

	if !isXMLName(node.Data) {
		cw.writeChildren(node)

		return
	}

	cw.out.WriteString("<" + node.Data)
	cw.writeAttributes(node.Data, node.Attr)

	if _, ok := voidElements[node.Data]; ok {
		cw.out.WriteString("/>")

		return
	}

	cw.out.WriteString(">")
	cw.writeChildren(node)
	cw.out.WriteString("</" + node.Data + ">")
}

func (cw *chapterWriter) writeImageElement(node *html.Node) {
	if len(cw.rewrites) == 0 {
		return
	}

	rewritten, ok := cw.rewrites[cw.nodeURLs[node]]
	if !ok {
		return
	}

	cw.out.WriteString("<img")
	cw.writeImageAttributes(node.Attr, rewritten)
	cw.out.WriteString("/>")
}

func (cw *chapterWriter) writeImageAttributes(attrs []html.Attribute, src string) {
	wroteSrc := false
	for _, attr := range attrs {
		if !isXMLName(attr.Key) {
			continue
		}

		val := attr.Val
		if attr.Key == "src" {
			val = src
			wroteSrc = true
		} else if isRemoteResourceAttr("img", attr.Key, val) {
			cw.hasRemoteResources = true
		}

		writeXMLAttr(&cw.out, attr.Key, val)
	}

	if !wroteSrc {
		writeXMLAttr(&cw.out, "src", src)
	}
}

func (cw *chapterWriter) writeAttributes(tag string, attrs []html.Attribute) {
	for _, attr := range attrs {
		if !isXMLName(attr.Key) {
			continue
		}

		if isRemoteResourceAttr(tag, attr.Key, attr.Val) {
			cw.hasRemoteResources = true
		}

		writeXMLAttr(&cw.out, attr.Key, attr.Val)
	}
}

func isRemoteResourceAttr(tag string, key string, val string) bool {
	switch {
	case key == "src":
		return isRemoteResourceURL(val)
	case key == "poster" && tag == "video":
		return isRemoteResourceURL(val)
	case key == "data" && tag == "object":
		return isRemoteResourceURL(val)
	case key == "href" && tag == "link":
		return isRemoteResourceURL(val)
	case key == "srcset":
		return hasRemoteSrcsetURL(val)
	default:
		return false
	}
}

func hasRemoteSrcsetURL(val string) bool {
	for candidate := range strings.SplitSeq(val, ",") {
		fields := strings.Fields(candidate)
		if len(fields) > 0 && isRemoteResourceURL(fields[0]) {
			return true
		}
	}

	return false
}

func isRemoteResourceURL(raw string) bool {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return false
	}

	if strings.HasPrefix(trimmed, "//") {
		return true
	}

	u, err := url.Parse(trimmed)
	if err != nil {
		return false
	}

	return strings.EqualFold(u.Scheme, "http") || strings.EqualFold(u.Scheme, "https")
}

func writeXMLAttr(out *strings.Builder, key string, val string) {
	out.WriteString(" " + key + "=\"")
	writeEscapedAttr(builderXMLWriter{sb: out}, val)
	out.WriteString("\"")
}

type xmlWriter interface {
	ok() bool
	writeString(string)
	writeRune(rune)
}

type builderXMLWriter struct {
	sb *strings.Builder
}

func (w builderXMLWriter) ok() bool {
	return true
}

func (w builderXMLWriter) writeString(s string) {
	w.sb.WriteString(s)
}

func (w builderXMLWriter) writeRune(r rune) {
	w.sb.WriteRune(r)
}

func writeEscapedText(out xmlWriter, text string) {
	for _, r := range text {
		if !out.ok() {
			return
		}

		switch r {
		case '&':
			out.writeString("&amp;")
		case '<':
			out.writeString("&lt;")
		case '>':
			out.writeString("&gt;")
		default:
			if isXMLChar(r) {
				out.writeRune(r)
			}
		}
	}
}

func writeEscapedAttr(out xmlWriter, text string) {
	for _, r := range text {
		if !out.ok() {
			return
		}

		switch r {
		case '&':
			out.writeString("&amp;")
		case '<':
			out.writeString("&lt;")
		case '>':
			out.writeString("&gt;")
		case '"':
			out.writeString("&quot;")
		case '\t':
			out.writeString("&#9;")
		case '\n':
			out.writeString("&#10;")
		case '\r':
			out.writeString("&#13;")
		default:
			if isXMLChar(r) {
				out.writeRune(r)
			}
		}
	}
}

func escapeXMLText(text string) string {
	var out strings.Builder
	writeEscapedText(builderXMLWriter{sb: &out}, text)

	return out.String()
}

func escapeXMLAttr(text string) string {
	var out strings.Builder
	writeEscapedAttr(builderXMLWriter{sb: &out}, text)

	return out.String()
}

func isXMLChar(r rune) bool {
	return r == '\t' || r == '\n' || r == '\r' || (r >= 0x20 && r <= 0xD7FF) || (r >= 0xE000 && r <= 0xFFFD) || (r >= 0x10000 && r <= 0x10FFFF)
}

func isXMLName(name string) bool {
	if name == "" {
		return false
	}

	for i, r := range name {
		if i == 0 {
			if !isXMLNameStartChar(r) {
				return false
			}

			continue
		}

		if !isXMLNameChar(r) {
			return false
		}
	}

	return true
}

func isXMLNameStartChar(r rune) bool {
	return isASCIILetter(r) || r == '_'
}

func isXMLNameChar(r rune) bool {
	return isXMLNameStartChar(r) || isASCIIDigit(r) || r == '-' || r == '.' || r == ':'
}

func isASCIILetter(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
}

func isASCIIDigit(r rune) bool {
	return r >= '0' && r <= '9'
}
