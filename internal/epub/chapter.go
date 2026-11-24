package epub

import (
	"fmt"
	"net/url"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"reader/internal/domain"
)

const untitledArticle = "Untitled"

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

func renderChapter(ch chapterInput, rewrites map[string]string) []byte {
	title := chapterTitle(ch.article)

	var out strings.Builder
	out.WriteString(xmlDeclaration)
	out.WriteString("<!DOCTYPE html>\n")
	out.WriteString(xhtmlOpenTag)
	out.WriteString("<head>\n<title>")
	writeEscapedText(&out, title)
	out.WriteString("</title>\n<link rel=\"stylesheet\" type=\"text/css\" href=\"../styles.css\"/>\n</head>\n<body>\n<h1>")
	writeEscapedText(&out, title)
	out.WriteString("</h1>\n")
	writeChapterMeta(&out, ch.article)
	out.WriteString("<div class=\"article-content\">")
	writeChildren(&out, ch.root, ch.nodeURLs, rewrites)
	out.WriteString("</div>\n</body>\n</html>\n")

	return []byte(out.String())
}

func writeChapterMeta(out *strings.Builder, article domain.KindleArticle) {
	parts := make([]string, 0, 3)

	if sourceTitle := strings.TrimSpace(article.SourceTitle); sourceTitle != "" {
		parts = append(parts, escapeXMLText(sourceTitle))
	}

	if article.PublishedAt != nil {
		parts = append(parts, escapeXMLText(article.PublishedAt.Format("2006-01-02 15:04")))
	}

	if articleURL := strings.TrimSpace(article.URL); articleURL != "" {
		parts = append(parts, "<a href=\""+escapeXMLAttr(articleURL)+"\">原文链接</a>")
	}

	if len(parts) == 0 {
		return
	}

	out.WriteString("<p class=\"article-meta\">" + strings.Join(parts, " · ") + "</p>\n")
}

func chapterTitle(article domain.KindleArticle) string {
	if title := strings.TrimSpace(article.Title); title != "" {
		return title
	}

	return untitledArticle
}

func writeChildren(out *strings.Builder, parent *html.Node, nodeURLs map[*html.Node]string, rewrites map[string]string) {
	for child := parent.FirstChild; child != nil; child = child.NextSibling {
		writeNode(out, child, nodeURLs, rewrites)
	}
}

func writeNode(out *strings.Builder, node *html.Node, nodeURLs map[*html.Node]string, rewrites map[string]string) {
	switch node.Type {
	case html.TextNode:
		writeEscapedText(out, node.Data)
	case html.ElementNode:
		writeElement(out, node, nodeURLs, rewrites)
	}
}

func writeElement(out *strings.Builder, node *html.Node, nodeURLs map[*html.Node]string, rewrites map[string]string) {
	if node.Data == "img" {
		writeImageElement(out, node, nodeURLs, rewrites)
		return
	}

	if !isXMLName(node.Data) {
		writeChildren(out, node, nodeURLs, rewrites)
		return
	}

	out.WriteString("<" + node.Data)
	writeAttributes(out, node.Attr)

	if _, ok := voidElements[node.Data]; ok {
		out.WriteString("/>")
		return
	}

	out.WriteString(">")
	writeChildren(out, node, nodeURLs, rewrites)
	out.WriteString("</" + node.Data + ">")
}

func writeImageElement(out *strings.Builder, node *html.Node, nodeURLs map[*html.Node]string, rewrites map[string]string) {
	if len(rewrites) == 0 {
		return
	}

	rewritten, ok := rewrites[nodeURLs[node]]
	if !ok {
		return
	}

	out.WriteString("<img")
	writeImageAttributes(out, node.Attr, rewritten)
	out.WriteString("/>")
}

func writeImageAttributes(out *strings.Builder, attrs []html.Attribute, src string) {
	wroteSrc := false
	for _, attr := range attrs {
		if !isXMLName(attr.Key) {
			continue
		}

		val := attr.Val
		if attr.Key == "src" {
			val = src
			wroteSrc = true
		}

		writeXMLAttr(out, attr.Key, val)
	}

	if !wroteSrc {
		writeXMLAttr(out, "src", src)
	}
}

func writeAttributes(out *strings.Builder, attrs []html.Attribute) {
	for _, attr := range attrs {
		if !isXMLName(attr.Key) {
			continue
		}

		writeXMLAttr(out, attr.Key, attr.Val)
	}
}

func writeXMLAttr(out *strings.Builder, key string, val string) {
	out.WriteString(" " + key + "=\"")
	writeEscapedAttr(out, val)
	out.WriteString("\"")
}

func writeEscapedText(out *strings.Builder, text string) {
	for _, r := range text {
		switch r {
		case '&':
			out.WriteString("&amp;")
		case '<':
			out.WriteString("&lt;")
		case '>':
			out.WriteString("&gt;")
		default:
			if isXMLChar(r) {
				out.WriteRune(r)
			}
		}
	}
}

func writeEscapedAttr(out *strings.Builder, text string) {
	for _, r := range text {
		switch r {
		case '&':
			out.WriteString("&amp;")
		case '<':
			out.WriteString("&lt;")
		case '>':
			out.WriteString("&gt;")
		case '"':
			out.WriteString("&quot;")
		case '\t':
			out.WriteString("&#9;")
		case '\n':
			out.WriteString("&#10;")
		case '\r':
			out.WriteString("&#13;")
		default:
			if isXMLChar(r) {
				out.WriteRune(r)
			}
		}
	}
}

func escapeXMLText(text string) string {
	var out strings.Builder
	writeEscapedText(&out, text)

	return out.String()
}

func escapeXMLAttr(text string) string {
	var out strings.Builder
	writeEscapedAttr(&out, text)

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
