package content

import (
	"bytes"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"html"
	"io"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/mmcdole/gofeed"
	"github.com/mmcdole/gofeed/atom"
	gofeedjson "github.com/mmcdole/gofeed/json"
	"github.com/mmcdole/gofeed/rss"

	"reader/internal/domain"
)

const untitledFeedTitle = "Untitled"

var (
	utf8BOM     = []byte{0xEF, 0xBB, 0xBF}
	dateLayouts = []string{
		time.RFC3339,
		time.RFC3339Nano,
		"2006-01-02T15:04:05Z0700",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
)

type Parser struct {
	sanitizer domain.HTMLSanitizer
}

type payloadScan struct {
	root         string
	summaryTypes []string
}

func NewFeedParser(sanitizer domain.HTMLSanitizer) *Parser {
	return &Parser{sanitizer: sanitizer}
}

func (p *Parser) ParseFeed(body []byte, baseURL string) (domain.ParsedFeed, error) {
	payload := bytes.TrimSpace(bytes.TrimPrefix(body, utf8BOM))
	if len(payload) == 0 {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, nil)
	}

	parser := gofeed.NewParser()
	parser.KeepOriginalFeed = true

	parsed, err := parser.Parse(bytes.NewReader(payload))
	if err != nil {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
	}

	scan, err := validatePayload(payload)
	if err != nil {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
	}

	var (
		entries     []domain.ParsedFeedEntry
		description *string
	)

	switch feed := parsed.OriginalFeed().(type) {
	case *rss.Feed:
		isRDF := strings.EqualFold(scan.root, "RDF") || feed.Version == "1.0"
		entries = p.parseRSSItems(feed.Items, baseURL, isRDF)
		description = optionalText(feed.Description)
	case *atom.Feed:
		entries = p.parseAtomEntries(feed.Entries, scan.summaryTypes, baseURL)
		description = optionalText(feed.Subtitle)
	case *gofeedjson.Feed:
		entries = p.parseJSONItems(feed.Items, baseURL)
		description = optionalText(feed.Description)
	default:
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, errors.New("unsupported feed format"))
	}

	return domain.ParsedFeed{
		Title:       feedTitle(parsed.Title, baseURL),
		Description: description,
		Entries:     entries,
	}, nil
}

func (p *Parser) parseRSSItems(
	items []*rss.Item,
	baseURL string,
	isRDF bool,
) []domain.ParsedFeedEntry {
	entries := make([]domain.ParsedFeedEntry, 0, len(items))

	for _, item := range items {
		if item == nil {
			continue
		}

		entryURL, ok := normalizedEntryURL(baseURL, item.Link)
		if !ok {
			continue
		}

		description, err := p.sanitizeOptional(item.Description, entryURL.RedactedString())
		if err != nil {
			logSkippedEntry(entryURL, err)

			continue
		}

		content, err := p.sanitizeOptional(item.Content, entryURL.RedactedString())
		if err != nil {
			logSkippedEntry(entryURL, err)

			continue
		}

		publishedAt := rssPublishedAt(item, isRDF)

		entries = append(entries, buildEntry(item.Title, description, content, entryURL, publishedAt))
	}

	return entries
}

func (p *Parser) parseAtomEntries(
	entries []*atom.Entry,
	summaryTypes []string,
	baseURL string,
) []domain.ParsedFeedEntry {
	parsed := make([]domain.ParsedFeedEntry, 0, len(entries))

	for index, entry := range entries {
		if entry == nil {
			continue
		}

		entryURL, ok := normalizedEntryURL(baseURL, atomEntryHref(entry.Links))
		if !ok {
			continue
		}

		description, err := p.atomSummary(entry.Summary, summaryTypeAt(summaryTypes, index), entryURL.RedactedString())
		if err != nil {
			logSkippedEntry(entryURL, err)

			continue
		}

		content, err := p.atomContent(entry.Content, entryURL.RedactedString())
		if err != nil {
			logSkippedEntry(entryURL, err)

			continue
		}

		publishedAt := utcOptional(entry.PublishedParsed)

		parsed = append(parsed, buildEntry(entry.Title, description, content, entryURL, publishedAt))
	}

	return parsed
}

func (p *Parser) parseJSONItems(
	items []*gofeedjson.Item,
	baseURL string,
) []domain.ParsedFeedEntry {
	entries := make([]domain.ParsedFeedEntry, 0, len(items))

	for _, item := range items {
		if item == nil {
			continue
		}

		entryURL, ok := normalizedEntryURL(baseURL, item.URL)
		if !ok {
			continue
		}

		description, err := p.jsonItemDescription(item, entryURL.RedactedString())
		if err != nil {
			logSkippedEntry(entryURL, err)

			continue
		}

		content, err := p.jsonItemContent(item, entryURL.RedactedString())
		if err != nil {
			logSkippedEntry(entryURL, err)

			continue
		}

		publishedAt := parseDate(item.DatePublished)

		entries = append(entries, buildEntry(item.Title, description, content, entryURL, publishedAt))
	}

	return entries
}

func (p *Parser) atomSummary(summary string, summaryType string, baseURL string) (*string, error) {
	if strings.TrimSpace(summary) == "" {
		return nil, nil
	}

	value := summary
	switch strings.ToLower(strings.TrimSpace(summaryType)) {
	case "", "text", "text/plain":
		value = html.EscapeString(summary)
	}

	return p.sanitizeOptional(value, baseURL)
}

func (p *Parser) atomContent(content *atom.Content, baseURL string) (*string, error) {
	if content == nil || strings.TrimSpace(content.Src) != "" {
		return nil, nil
	}

	if strings.TrimSpace(content.Value) == "" {
		return nil, nil
	}

	value := content.Value
	switch strings.ToLower(strings.TrimSpace(content.Type)) {
	case "", "text", "text/plain":
		value = html.EscapeString(value)
	}

	return p.sanitizeOptional(value, baseURL)
}

func (p *Parser) jsonItemDescription(item *gofeedjson.Item, baseURL string) (*string, error) {
	if strings.TrimSpace(item.Summary) == "" {
		return nil, nil
	}

	return p.sanitizeOptional(html.EscapeString(item.Summary), baseURL)
}

func (p *Parser) jsonItemContent(item *gofeedjson.Item, baseURL string) (*string, error) {
	if strings.TrimSpace(item.ContentHTML) != "" {
		return p.sanitizeOptional(item.ContentHTML, baseURL)
	}

	if strings.TrimSpace(item.ContentText) != "" {
		return p.sanitizeOptional(html.EscapeString(item.ContentText), baseURL)
	}

	return nil, nil
}

func (p *Parser) sanitizeOptional(rawHTML string, baseURL string) (*string, error) {
	if strings.TrimSpace(rawHTML) == "" {
		return nil, nil
	}

	sanitized, err := p.sanitizer.SanitizeHTML(rawHTML, baseURL)
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(sanitized) == "" {
		return nil, nil
	}

	return &sanitized, nil
}

func buildEntry(
	rawTitle string,
	description *string,
	content *string,
	entryURL domain.NormalizedURL,
	publishedAt *time.Time,
) domain.ParsedFeedEntry {
	title, normalizedDescription, normalizedContent := domain.NormalizeArticleValues(rawTitle, description, content)

	return domain.ParsedFeedEntry{
		URL:         entryURL,
		Title:       title,
		Description: normalizedDescription,
		Content:     normalizedContent,
		PublishedAt: publishedAt,
	}
}

func normalizedEntryURL(baseURL string, rawURL string) (domain.NormalizedURL, bool) {
	resolved, ok := resolveURL(baseURL, rawURL)
	if !ok {
		return domain.NormalizedURL{}, false
	}

	entryURL, err := domain.ParseNormalizedURL(resolved.String(), domain.ErrFeedUrlInvalid)
	if err != nil {
		return domain.NormalizedURL{}, false
	}

	return entryURL, true
}

func logSkippedEntry(entryURL domain.NormalizedURL, err error) {
	slog.Warn(
		"skipping feed entry with invalid html",
		"url", entryURL.RedactedString(),
		"error", domain.SanitizeErrorText(err.Error()),
	)
}

func rssPublishedAt(item *rss.Item, isRDF bool) *time.Time {
	if !isRDF {
		return utcOptional(item.PubDateParsed)
	}

	if item.DublinCoreExt == nil || len(item.DublinCoreExt.Date) == 0 {
		return nil
	}

	return parseDate(item.DublinCoreExt.Date[0])
}

func atomEntryHref(links []*atom.Link) string {
	for _, link := range links {
		if link == nil {
			continue
		}

		if isAlternateLink(link) && strings.EqualFold(link.Type, "text/html") && strings.TrimSpace(link.Href) != "" {
			return link.Href
		}
	}

	for _, link := range links {
		if link == nil {
			continue
		}

		if isAlternateLink(link) && strings.TrimSpace(link.Type) == "" && strings.TrimSpace(link.Href) != "" {
			return link.Href
		}
	}

	for _, link := range links {
		if link == nil {
			continue
		}

		if isAlternateLink(link) && strings.TrimSpace(link.Href) != "" {
			return link.Href
		}
	}

	return ""
}

func isAlternateLink(link *atom.Link) bool {
	rel := strings.TrimSpace(link.Rel)

	return rel == "" || strings.EqualFold(rel, "alternate")
}

func summaryTypeAt(summaryTypes []string, index int) string {
	if index < 0 || index >= len(summaryTypes) {
		return ""
	}

	return summaryTypes[index]
}

func feedTitle(rawTitle string, baseURL string) string {
	title := strings.TrimSpace(rawTitle)
	if title != "" {
		return title
	}

	if parsed, err := url.Parse(strings.TrimSpace(baseURL)); err == nil {
		if host := strings.ToLower(parsed.Host); host != "" {
			return host
		}
	}

	return untitledFeedTitle
}

func optionalText(raw string) *string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}

	return &trimmed
}

func utcOptional(value *time.Time) *time.Time {
	if value == nil || value.IsZero() {
		return nil
	}

	utc := value.UTC()

	return &utc
}

func parseDate(raw string) *time.Time {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}

	for _, layout := range dateLayouts {
		parsed, err := time.Parse(layout, trimmed)
		if err != nil {
			continue
		}

		utc := parsed.UTC()

		return &utc
	}

	return nil
}

func validatePayload(payload []byte) (payloadScan, error) {
	switch payload[0] {
	case '{':
		return validateJSONPayload(payload)
	case '<':
		return validateXMLPayload(payload)
	default:
		return payloadScan{}, errors.New("unsupported feed payload")
	}
}

func validateJSONPayload(payload []byte) (payloadScan, error) {
	feed := gofeedjson.Feed{}
	decoder := json.NewDecoder(bytes.NewReader(payload))

	if err := decoder.Decode(&feed); err != nil {
		return payloadScan{}, err
	}

	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return payloadScan{}, errors.New("trailing data after json feed")
	}

	if !strings.Contains(strings.ToLower(feed.Version), "jsonfeed.org/version/") {
		return payloadScan{}, errors.New("unsupported json feed version")
	}

	return payloadScan{}, nil
}

func validateXMLPayload(payload []byte) (payloadScan, error) {
	decoder := xml.NewDecoder(bytes.NewReader(payload))
	scan := payloadScan{}
	depth := 0
	entryDepth := 0
	summaryFound := false

	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			if depth != 0 {
				return payloadScan{}, errors.New("truncated xml feed")
			}

			if scan.root == "" {
				return payloadScan{}, errors.New("missing xml root element")
			}

			return scan, nil
		}
		if err != nil {
			return payloadScan{}, err
		}

		switch typed := token.(type) {
		case xml.StartElement:
			if depth == 0 {
				if scan.root != "" {
					return payloadScan{}, errors.New("multiple xml root elements")
				}

				if err := validateRootElement(typed.Name.Local); err != nil {
					return payloadScan{}, err
				}

				scan.root = typed.Name.Local
			}

			depth++
			if strings.EqualFold(scan.root, "feed") && depth == 2 && isAtomElement(typed.Name, "entry") && entryDepth == 0 {
				entryDepth = depth
				summaryFound = false
				scan.summaryTypes = append(scan.summaryTypes, "")

				continue
			}

			if entryDepth == 2 && depth == 3 && isAtomElement(typed.Name, "summary") && !summaryFound {
				scan.summaryTypes[len(scan.summaryTypes)-1] = xmlAttributeValue(typed, "type")
				summaryFound = true
			}
		case xml.EndElement:
			if depth == 0 {
				return payloadScan{}, errors.New("unexpected closing element")
			}

			if depth == entryDepth {
				entryDepth = 0
			}

			depth--
		case xml.CharData:
			if depth == 0 && strings.TrimSpace(string(typed)) != "" {
				return payloadScan{}, errors.New("content outside root element")
			}
		}
	}
}

func isAtomElement(name xml.Name, local string) bool {
	if !strings.EqualFold(name.Local, local) {
		return false
	}

	space := strings.TrimSpace(name.Space)

	return space == "" || space == "http://www.w3.org/2005/Atom" || space == "http://purl.org/atom/ns#"
}

func validateRootElement(name string) error {
	switch strings.ToLower(name) {
	case "rss", "rdf", "feed":
		return nil
	}

	return fmt.Errorf("unsupported xml root element %q", name)
}

func xmlAttributeValue(element xml.StartElement, key string) string {
	for _, attr := range element.Attr {
		if attr.Name.Local == key {
			return attr.Value
		}
	}

	return ""
}
