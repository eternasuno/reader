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
	contentTypes []string
}

func NewFeedParser(sanitizer domain.HTMLSanitizer) *Parser {
	return &Parser{sanitizer: sanitizer}
}

func (p *Parser) ParseFeed(body []byte, baseURL string) (domain.ParsedFeed, error) {
	payload := bytes.TrimSpace(bytes.TrimPrefix(body, utf8BOM))
	if len(payload) == 0 {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, nil)
	}

	base := parseBaseURL(baseURL)

	switch payload[0] {
	case '{':
		return p.parseJSONFeed(payload, base)
	case '<':
		return p.parseXMLFeed(payload, base)
	default:
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, errors.New("unsupported feed payload"))
	}
}

func (p *Parser) parseJSONFeed(payload []byte, base *url.URL) (domain.ParsedFeed, error) {
	feed, err := decodeJSONFeed(payload)
	if err != nil {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
	}

	return domain.ParsedFeed{
		Title:       feedTitle(feed.Title, base),
		Description: optionalText(feed.Description),
		Entries:     p.parseJSONItems(feed.Items, base),
	}, nil
}

func (p *Parser) parseXMLFeed(payload []byte, base *url.URL) (domain.ParsedFeed, error) {
	feedType := gofeed.DetectFeedType(bytes.NewReader(payload))
	if feedType != gofeed.FeedTypeRSS && feedType != gofeed.FeedTypeAtom {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, errors.New("unsupported feed format"))
	}

	scan, err := validateXMLPayload(payload)
	if err != nil {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
	}

	if feedType == gofeed.FeedTypeRSS {
		feed, err := (&rss.Parser{}).Parse(bytes.NewReader(payload))
		if err != nil {
			return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
		}

		isRDF := strings.EqualFold(scan.root, "RDF") || feed.Version == "1.0"

		return domain.ParsedFeed{
			Title:       feedTitle(rssFeedTitle(feed), base),
			Description: optionalText(feed.Description),
			Entries:     p.parseRSSItems(feed.Items, base, isRDF),
		}, nil
	}

	feed, err := (&atom.Parser{}).Parse(bytes.NewReader(payload))
	if err != nil {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
	}

	return domain.ParsedFeed{
		Title:       feedTitle(feed.Title, base),
		Description: optionalText(feed.Subtitle),
		Entries:     p.parseAtomEntries(feed.Entries, scan, base),
	}, nil
}

func (p *Parser) parseRSSItems(
	items []*rss.Item,
	base *url.URL,
	isRDF bool,
) []domain.ParsedFeedEntry {
	entries := make([]domain.ParsedFeedEntry, 0, len(items))

	for _, item := range items {
		if item == nil {
			continue
		}

		entryURL, ok := normalizedEntryURL(base, item.Link)
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

		entries = append(entries, buildEntry(rssItemTitle(item), description, content, entryURL, publishedAt))
	}

	return entries
}

func (p *Parser) parseAtomEntries(
	entries []*atom.Entry,
	scan payloadScan,
	base *url.URL,
) []domain.ParsedFeedEntry {
	parsed := make([]domain.ParsedFeedEntry, 0, len(entries))

	for index, entry := range entries {
		if entry == nil {
			continue
		}

		entryURL, ok := normalizedEntryURL(base, atomEntryHref(entry.Links))
		if !ok {
			continue
		}

		description, err := p.atomSummary(entry.Summary, attrTypeAt(scan.summaryTypes, index), entryURL.RedactedString())
		if err != nil {
			logSkippedEntry(entryURL, err)

			continue
		}

		content, err := p.atomContent(entry.Content, attrTypeAt(scan.contentTypes, index), entryURL.RedactedString())
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
	base *url.URL,
) []domain.ParsedFeedEntry {
	entries := make([]domain.ParsedFeedEntry, 0, len(items))

	for _, item := range items {
		if item == nil {
			continue
		}

		entryURL, ok := normalizedEntryURL(base, item.URL)
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

func (p *Parser) atomContent(content *atom.Content, contentType string, baseURL string) (*string, error) {
	if content == nil || strings.TrimSpace(content.Src) != "" {
		return nil, nil
	}

	if strings.TrimSpace(content.Value) == "" {
		return nil, nil
	}

	value := content.Value
	switch strings.ToLower(strings.TrimSpace(contentType)) {
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

func normalizedEntryURL(base *url.URL, rawURL string) (domain.NormalizedURL, bool) {
	resolved, ok := resolveWithBase(base, rawURL)
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
	if href := findAlternateHref(links, func(linkType string) bool {
		return strings.EqualFold(linkType, "text/html")
	}); href != "" {
		return href
	}

	if href := findAlternateHref(links, func(linkType string) bool {
		return strings.TrimSpace(linkType) == ""
	}); href != "" {
		return href
	}

	return findAlternateHref(links, func(string) bool { return true })
}

func findAlternateHref(links []*atom.Link, matchType func(string) bool) string {
	for _, link := range links {
		if isMatchingAlternateLink(link, matchType) {
			return link.Href
		}
	}

	return ""
}

func isMatchingAlternateLink(link *atom.Link, matchType func(string) bool) bool {
	if link == nil || strings.TrimSpace(link.Href) == "" || !isAlternateLink(link) {
		return false
	}

	return matchType(link.Type)
}

func isAlternateLink(link *atom.Link) bool {
	rel := strings.TrimSpace(link.Rel)

	return rel == "" || strings.EqualFold(rel, "alternate")
}

func attrTypeAt(types []string, index int) string {
	if index < 0 || index >= len(types) {
		return ""
	}

	return types[index]
}

func rssFeedTitle(feed *rss.Feed) string {
	if strings.TrimSpace(feed.Title) != "" {
		return feed.Title
	}

	if feed.DublinCoreExt != nil && len(feed.DublinCoreExt.Title) > 0 {
		return feed.DublinCoreExt.Title[0]
	}

	return ""
}

func rssItemTitle(item *rss.Item) string {
	if strings.TrimSpace(item.Title) != "" {
		return item.Title
	}

	if item.DublinCoreExt != nil && len(item.DublinCoreExt.Title) > 0 {
		return item.DublinCoreExt.Title[0]
	}

	return ""
}

func feedTitle(rawTitle string, base *url.URL) string {
	title := strings.TrimSpace(rawTitle)
	if title != "" {
		return title
	}

	if base != nil {
		if host := strings.ToLower(base.Host); host != "" {
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

func decodeJSONFeed(payload []byte) (gofeedjson.Feed, error) {
	feed := gofeedjson.Feed{}
	decoder := json.NewDecoder(bytes.NewReader(payload))

	if err := decoder.Decode(&feed); err != nil {
		return gofeedjson.Feed{}, err
	}

	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return gofeedjson.Feed{}, errors.New("trailing data after json feed")
	}

	if !strings.Contains(strings.ToLower(feed.Version), "jsonfeed.org/version/") {
		return gofeedjson.Feed{}, errors.New("unsupported json feed version")
	}

	return feed, nil
}

type xmlPayloadValidator struct {
	scan         payloadScan
	depth        int
	entryDepth   int
	summaryFound bool
	contentFound bool
}

func validateXMLPayload(payload []byte) (payloadScan, error) {
	decoder := xml.NewDecoder(bytes.NewReader(payload))
	validator := xmlPayloadValidator{}

	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			return validator.finish()
		}
		if err != nil {
			return payloadScan{}, err
		}

		if err := validator.handleToken(token); err != nil {
			return payloadScan{}, err
		}
	}
}

func (v *xmlPayloadValidator) finish() (payloadScan, error) {
	if v.depth != 0 {
		return payloadScan{}, errors.New("truncated xml feed")
	}

	if v.scan.root == "" {
		return payloadScan{}, errors.New("missing xml root element")
	}

	return v.scan, nil
}

func (v *xmlPayloadValidator) handleToken(token xml.Token) error {
	switch typed := token.(type) {
	case xml.StartElement:
		return v.handleStart(typed)
	case xml.EndElement:
		return v.handleEnd()
	case xml.CharData:
		if v.depth == 0 && strings.TrimSpace(string(typed)) != "" {
			return errors.New("content outside root element")
		}
	}

	return nil
}

func (v *xmlPayloadValidator) handleStart(element xml.StartElement) error {
	if v.depth == 0 {
		if err := v.setRoot(element.Name.Local); err != nil {
			return err
		}
	}

	v.depth++
	v.trackAtomEntry(element)

	return nil
}

func (v *xmlPayloadValidator) setRoot(name string) error {
	if v.scan.root != "" {
		return errors.New("multiple xml root elements")
	}

	if err := validateRootElement(name); err != nil {
		return err
	}

	v.scan.root = name

	return nil
}

func (v *xmlPayloadValidator) trackAtomEntry(element xml.StartElement) {
	if v.isNewAtomEntry(element) {
		v.entryDepth = v.depth
		v.summaryFound = false
		v.contentFound = false
		v.scan.summaryTypes = append(v.scan.summaryTypes, "")
		v.scan.contentTypes = append(v.scan.contentTypes, "")

		return
	}

	if v.isEntrySummary(element) {
		v.scan.summaryTypes[len(v.scan.summaryTypes)-1] = xmlAttributeValue(element, "type")
		v.summaryFound = true

		return
	}

	if v.isEntryContent(element) {
		v.scan.contentTypes[len(v.scan.contentTypes)-1] = xmlAttributeValue(element, "type")
		v.contentFound = true
	}
}

func (v *xmlPayloadValidator) isNewAtomEntry(element xml.StartElement) bool {
	return strings.EqualFold(v.scan.root, "feed") && v.depth == 2 && v.entryDepth == 0 && isAtomElement(element.Name, "entry")
}

func (v *xmlPayloadValidator) isEntrySummary(element xml.StartElement) bool {
	return v.entryDepth == 2 && v.depth == 3 && !v.summaryFound && isAtomElement(element.Name, "summary")
}

func (v *xmlPayloadValidator) isEntryContent(element xml.StartElement) bool {
	return v.entryDepth == 2 && v.depth == 3 && !v.contentFound && isAtomElement(element.Name, "content")
}

func (v *xmlPayloadValidator) handleEnd() error {
	if v.depth == 0 {
		return errors.New("unexpected closing element")
	}

	if v.depth == v.entryDepth {
		v.entryDepth = 0
	}

	v.depth--

	return nil
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
		if attr.Name.Space == "" && attr.Name.Local == key {
			return attr.Value
		}
	}

	return ""
}
