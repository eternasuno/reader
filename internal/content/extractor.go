package content

import (
	"bytes"
	stdhtml "html"
	"net/url"
	"strings"
	"time"

	"codeberg.org/readeck/go-readability/v2"
	"golang.org/x/net/html"

	"reader/internal/domain"
)

type Extractor struct {
	sanitizer domain.HTMLSanitizer
}

func NewArticleExtractor(sanitizer domain.HTMLSanitizer) *Extractor {
	return &Extractor{sanitizer: sanitizer}
}

func (e *Extractor) ExtractArticle(htmlBody string, pageURL string) (domain.ExtractedArticle, error) {
	article, err := extractReadableArticle(htmlBody, pageURL)
	if err != nil {
		return domain.ExtractedArticle{}, err
	}

	sanitized, err := e.renderSanitizedArticle(article, pageURL)
	if err != nil {
		return domain.ExtractedArticle{}, err
	}

	description, err := e.articleExcerpt(article, pageURL)
	if err != nil {
		return domain.ExtractedArticle{}, domain.NewError(domain.ErrArticleExtractorError, err)
	}

	title, description, content := domain.NormalizeArticleValues(article.Title(), description, &sanitized)
	if content == nil || *content == "" {
		return domain.ExtractedArticle{}, domain.NewError(domain.ErrArticleEmptyContent, nil)
	}

	return domain.ExtractedArticle{
		Title:       title,
		Description: description,
		Content:     *content,
		PublishedAt: articlePublishedAt(article),
	}, nil
}

func extractReadableArticle(htmlBody string, pageURL string) (readability.Article, error) {
	parsedURL, err := url.Parse(pageURL)
	if err != nil {
		return readability.Article{}, domain.NewError(domain.ErrArticleExtractorError, err)
	}

	if strings.TrimSpace(htmlBody) == "" {
		return readability.Article{}, domain.NewError(domain.ErrArticleEmptyContent, nil)
	}

	article, err := readability.FromReader(strings.NewReader(htmlBody), parsedURL)
	if err != nil {
		return readability.Article{}, domain.NewError(domain.ErrArticleExtractorError, err)
	}

	if article.Node == nil {
		return readability.Article{}, domain.NewError(domain.ErrArticleEmptyContent, nil)
	}

	return article, nil
}

func (e *Extractor) renderSanitizedArticle(article readability.Article, pageURL string) (string, error) {
	var rendered bytes.Buffer
	if err := article.RenderHTML(&rendered); err != nil {
		return "", domain.NewError(domain.ErrArticleExtractorError, err)
	}

	sanitized, err := e.sanitizer.SanitizeHTML(rendered.String(), pageURL)
	if err != nil {
		return "", domain.NewError(domain.ErrArticleExtractorError, err)
	}

	if !hasVisibleContent(sanitized) {
		return "", domain.NewError(domain.ErrArticleEmptyContent, nil)
	}

	return sanitized, nil
}

func (e *Extractor) articleExcerpt(article readability.Article, pageURL string) (*string, error) {
	excerpt := strings.TrimSpace(article.Excerpt())
	if excerpt == "" {
		return nil, nil
	}

	sanitized, err := e.sanitizer.SanitizeHTML(stdhtml.EscapeString(excerpt), pageURL)
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(sanitized) == "" {
		return nil, nil
	}

	return &sanitized, nil
}

func articlePublishedAt(article readability.Article) *time.Time {
	published, err := article.PublishedTime()
	if err != nil || published.IsZero() {
		return nil
	}

	utc := published.UTC()

	return &utc
}

func hasVisibleContent(fragment string) bool {
	if strings.TrimSpace(fragment) == "" {
		return false
	}

	nodes, err := html.ParseFragment(strings.NewReader(fragment), fragmentContainer())
	if err != nil {
		return true
	}

	for _, node := range nodes {
		if nodeHasVisibleContent(node) {
			return true
		}
	}

	return false
}

func nodeHasVisibleContent(node *html.Node) bool {
	if node.Type == html.TextNode {
		return strings.TrimSpace(node.Data) != ""
	}

	if node.Type == html.ElementNode && isMediaElement(node.Data) {
		if src, ok := attributeValue(node, "src"); ok && strings.TrimSpace(src) != "" {
			return true
		}
	}

	for child := node.FirstChild; child != nil; child = child.NextSibling {
		if nodeHasVisibleContent(child) {
			return true
		}
	}

	return false
}

func isMediaElement(name string) bool {
	switch name {
	case "img", "video", "audio", "source":
		return true
	}

	return false
}
