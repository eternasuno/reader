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
	"golang.org/x/net/html/charset"

	"reader/internal/domain"
)

const (
	untitledFeedTitle  = "Untitled"
	maxFeedItems       = 1000
	maxFeedOutputBytes = maxSanitizedHTMLBytes
	maxFeedXMLDepth    = 64
	maxFeedJSONDepth   = 64
)

var (
	utf8BOM               = []byte{0xEF, 0xBB, 0xBF}
	errFeedBudgetExceeded = errors.New("feed parse budget exceeded")
	dateLayouts           = []string{
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

type feedLimits struct {
	maxItems       int
	maxOutputBytes int
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
	return p.parseFeedWithLimits(body, baseURL, feedLimits{
		maxItems:       maxFeedItems,
		maxOutputBytes: maxFeedOutputBytes,
	})
}

func (p *Parser) parseFeedWithLimits(body []byte, baseURL string, limits feedLimits) (domain.ParsedFeed, error) {
	payload := bytes.TrimSpace(bytes.TrimPrefix(body, utf8BOM))
	if len(payload) == 0 {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, nil)
	}

	base := parseBaseURL(baseURL)

	switch payload[0] {
	case '{':
		return p.parseJSONFeedReader(bytes.NewReader(payload), base, limits)
	case '<':
		return p.parseXMLFeed(payload, base, limits)
	default:
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, errors.New("unsupported feed payload"))
	}
}

func (p *Parser) parseJSONFeedReader(r io.Reader, base *url.URL, limits feedLimits) (domain.ParsedFeed, error) {
	feed, err := decodeJSONFeed(r, limits.maxItems)
	if err != nil {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
	}

	budget := byteBudget{remaining: limits.maxOutputBytes}
	title := feedTitle(feed.Title, base)
	description := optionalText(feed.Description)

	if err := consumeFeedHeader(title, description, &budget); err != nil {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
	}

	entries, err := p.parseJSONItems(feed.Items, base, &budget)
	if err != nil {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
	}

	return domain.ParsedFeed{
		Title:       title,
		Description: description,
		SiteURL:     feedURLCandidate(base, feed.HomePageURL),
		IconURL:     feedURLCandidate(base, feed.Favicon, feed.Icon),
		Entries:     entries,
	}, nil
}

func (p *Parser) parseXMLFeed(payload []byte, base *url.URL, limits feedLimits) (domain.ParsedFeed, error) {
	feedType := gofeed.DetectFeedType(bytes.NewReader(payload))
	if feedType != gofeed.FeedTypeRSS && feedType != gofeed.FeedTypeAtom {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, errors.New("unsupported feed format"))
	}

	scan, err := validateXMLPayload(payload, limits.maxItems)
	if err != nil {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
	}

	budget := byteBudget{remaining: limits.maxOutputBytes}
	if feedType == gofeed.FeedTypeRSS {
		return p.parseRSSFeed(payload, base, scan.root, &budget)
	}

	return p.parseAtomFeed(payload, base, scan, &budget)
}

func (p *Parser) parseRSSFeed(payload []byte, base *url.URL, root string, budget *byteBudget) (domain.ParsedFeed, error) {
	feed, err := (&rss.Parser{}).Parse(bytes.NewReader(payload))
	if err != nil {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
	}

	isRDF := strings.EqualFold(root, "RDF") || feed.Version == "1.0"
	title := feedTitle(rssFeedTitle(feed), base)
	description := optionalText(feed.Description)

	if err := consumeFeedHeader(title, description, budget); err != nil {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
	}

	entries, err := p.parseRSSItems(feed.Items, base, isRDF, budget)
	if err != nil {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
	}

	return domain.ParsedFeed{
		Title:       title,
		Description: description,
		SiteURL:     feedURLCandidate(base, feed.Link),
		IconURL:     feedURLCandidate(base, rssFeedIcon(feed)),
		Entries:     entries,
	}, nil
}

func (p *Parser) parseAtomFeed(payload []byte, base *url.URL, scan payloadScan, budget *byteBudget) (domain.ParsedFeed, error) {
	feed, err := (&atom.Parser{}).Parse(bytes.NewReader(payload))
	if err != nil {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
	}

	title := feedTitle(feed.Title, base)
	description := optionalText(feed.Subtitle)

	if err := consumeFeedHeader(title, description, budget); err != nil {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
	}

	entries, err := p.parseAtomEntries(feed.Entries, scan, base, budget)
	if err != nil {
		return domain.ParsedFeed{}, domain.NewError(domain.ErrFeedParserError, err)
	}

	return domain.ParsedFeed{
		Title:       title,
		Description: description,
		SiteURL:     feedURLCandidate(base, atomAlternateHref(feed.Links)),
		IconURL:     feedURLCandidate(base, feed.Icon, feed.Logo),
		Entries:     entries,
	}, nil
}

func (p *Parser) parseRSSItems(
	items []*rss.Item,
	base *url.URL,
	isRDF bool,
	budget *byteBudget,
) ([]domain.ParsedFeedEntry, error) {
	entries := make([]domain.ParsedFeedEntry, 0, len(items))

	for _, item := range items {
		if item == nil {
			continue
		}

		entryURL, ok := normalizedEntryURL(base, item.Link)
		if !ok {
			continue
		}

		entry, keep, err := buildBudgetedEntry(
			entryURL,
			rssItemTitle(item),
			rssPublishedAt(item, isRDF),
			func() (*string, error) {
				return p.sanitizeOptional(item.Description, entryURL.RedactedString(), budget)
			},
			func() (*string, error) {
				return p.sanitizeOptional(item.Content, entryURL.RedactedString(), budget)
			},
			budget,
		)
		if err != nil {
			return nil, err
		}

		if keep {
			entries = append(entries, entry)
		}
	}

	return entries, nil
}

func (p *Parser) parseAtomEntries(
	entries []*atom.Entry,
	scan payloadScan,
	base *url.URL,
	budget *byteBudget,
) ([]domain.ParsedFeedEntry, error) {
	parsed := make([]domain.ParsedFeedEntry, 0, len(entries))

	for index, entry := range entries {
		if entry == nil {
			continue
		}

		entryURL, ok := normalizedEntryURL(base, atomAlternateHref(entry.Links))
		if !ok {
			continue
		}

		item, keep, err := buildBudgetedEntry(
			entryURL,
			entry.Title,
			utcOptional(entry.PublishedParsed),
			func() (*string, error) {
				return p.atomSummary(entry.Summary, attrTypeAt(scan.summaryTypes, index), entryURL.RedactedString(), budget)
			},
			func() (*string, error) {
				return p.atomContent(entry.Content, attrTypeAt(scan.contentTypes, index), entryURL.RedactedString(), budget)
			},
			budget,
		)
		if err != nil {
			return nil, err
		}

		if keep {
			parsed = append(parsed, item)
		}
	}

	return parsed, nil
}

func (p *Parser) parseJSONItems(
	items []*gofeedjson.Item,
	base *url.URL,
	budget *byteBudget,
) ([]domain.ParsedFeedEntry, error) {
	entries := make([]domain.ParsedFeedEntry, 0, len(items))

	for _, item := range items {
		if item == nil {
			continue
		}

		entryURL, ok := normalizedEntryURL(base, item.URL)
		if !ok {
			continue
		}

		entry, keep, err := buildBudgetedEntry(
			entryURL,
			item.Title,
			parseDate(item.DatePublished),
			func() (*string, error) {
				return p.jsonItemDescription(item, entryURL.RedactedString(), budget)
			},
			func() (*string, error) {
				return p.jsonItemContent(item, entryURL.RedactedString(), budget)
			},
			budget,
		)
		if err != nil {
			return nil, err
		}

		if keep {
			entries = append(entries, entry)
		}
	}

	return entries, nil
}

func (p *Parser) atomSummary(summary string, summaryType string, baseURL string, budget *byteBudget) (*string, error) {
	if strings.TrimSpace(summary) == "" {
		return nil, nil
	}

	value := summary
	switch strings.ToLower(strings.TrimSpace(summaryType)) {
	case "", "text", "text/plain":
		value = html.EscapeString(summary)
	}

	return p.sanitizeOptional(value, baseURL, budget)
}

func (p *Parser) atomContent(content *atom.Content, contentType string, baseURL string, budget *byteBudget) (*string, error) {
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

	return p.sanitizeOptional(value, baseURL, budget)
}

func (p *Parser) jsonItemDescription(item *gofeedjson.Item, baseURL string, budget *byteBudget) (*string, error) {
	if strings.TrimSpace(item.Summary) == "" {
		return nil, nil
	}

	return p.sanitizeOptional(html.EscapeString(item.Summary), baseURL, budget)
}

func (p *Parser) jsonItemContent(item *gofeedjson.Item, baseURL string, budget *byteBudget) (*string, error) {
	if strings.TrimSpace(item.ContentHTML) != "" {
		return p.sanitizeOptional(item.ContentHTML, baseURL, budget)
	}

	if strings.TrimSpace(item.ContentText) != "" {
		return p.sanitizeOptional(html.EscapeString(item.ContentText), baseURL, budget)
	}

	return nil, nil
}

func (p *Parser) sanitizeOptional(rawHTML string, baseURL string, budget *byteBudget) (*string, error) {
	if strings.TrimSpace(rawHTML) == "" {
		return nil, nil
	}

	if budget.remaining <= 0 {
		return nil, errFeedBudgetExceeded
	}

	var (
		sanitized string
		err       error
	)

	if concrete, ok := p.sanitizer.(*Sanitizer); ok {
		sanitized, err = concrete.sanitizeHTMLWithBudget(rawHTML, baseURL, budget.remaining)
		if errors.Is(err, errHTMLBudgetExceeded) {
			return nil, errFeedBudgetExceeded
		}
	} else {
		sanitized, err = p.sanitizer.SanitizeHTML(rawHTML, baseURL)
	}

	if err != nil {
		return nil, err
	}

	trimmed := strings.TrimSpace(sanitized)
	if trimmed == "" {
		return nil, nil
	}

	if !budget.consume(len(trimmed)) {
		return nil, errFeedBudgetExceeded
	}

	return &trimmed, nil
}

func sanitizeEntryFields(
	entryURL domain.NormalizedURL,
	sanitizeDesc func() (*string, error),
	sanitizeContent func() (*string, error),
) (description *string, content *string, keep bool, err error) {
	description, err = sanitizeDesc()
	if err != nil {
		if errors.Is(err, errFeedBudgetExceeded) {
			return nil, nil, false, err
		}

		logSkippedEntry(entryURL, err)

		return nil, nil, false, nil
	}

	content, err = sanitizeContent()
	if err != nil {
		if errors.Is(err, errFeedBudgetExceeded) {
			return nil, nil, false, err
		}

		logSkippedEntry(entryURL, err)

		return nil, nil, false, nil
	}

	return description, content, true, nil
}

func consumeFeedHeader(title string, description *string, budget *byteBudget) error {
	if !budget.consume(len(title)) {
		return errFeedBudgetExceeded
	}

	if description != nil && !budget.consume(len(*description)) {
		return errFeedBudgetExceeded
	}

	return nil
}

func buildBudgetedEntry(
	entryURL domain.NormalizedURL,
	rawTitle string,
	publishedAt *time.Time,
	sanitizeDesc func() (*string, error),
	sanitizeContent func() (*string, error),
	budget *byteBudget,
) (domain.ParsedFeedEntry, bool, error) {
	description, content, keep, err := sanitizeEntryFields(entryURL, sanitizeDesc, sanitizeContent)
	if err != nil || !keep {
		return domain.ParsedFeedEntry{}, false, err
	}

	entry := buildEntry(rawTitle, description, content, entryURL, publishedAt)
	if !budget.consume(len(entry.Title)) || !budget.consume(len(entry.URL.Raw())) {
		return domain.ParsedFeedEntry{}, false, errFeedBudgetExceeded
	}

	return entry, true, nil
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

func atomAlternateHref(links []*atom.Link) string {
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

type jsonFeedDecodeState struct {
	feed      gofeedjson.Feed
	seenItems bool
}

func decodeJSONFeed(r io.Reader, maxItems int) (gofeedjson.Feed, error) {
	decoder := json.NewDecoder(r)

	if err := expectJSONDelimiter(decoder, '{', "json feed must be an object"); err != nil {
		return gofeedjson.Feed{}, err
	}

	var state jsonFeedDecodeState
	for decoder.More() {
		key, err := readJSONObjectKey(decoder)
		if err != nil {
			return gofeedjson.Feed{}, err
		}

		if err := decodeJSONFeedField(decoder, &state, key, maxItems); err != nil {
			return gofeedjson.Feed{}, err
		}
	}

	if err := expectJSONDelimiter(decoder, '}', "unexpected end of json feed object"); err != nil {
		return gofeedjson.Feed{}, err
	}

	if err := validateJSONFeedTrailer(decoder, state.feed.Version); err != nil {
		return gofeedjson.Feed{}, err
	}

	return state.feed, nil
}

func expectJSONDelimiter(decoder *json.Decoder, want json.Delim, mismatchMsg string) error {
	tok, err := decoder.Token()
	if err != nil {
		return err
	}

	if tok != want {
		return errors.New(mismatchMsg)
	}

	return nil
}

func readJSONObjectKey(decoder *json.Decoder) (string, error) {
	tok, err := decoder.Token()
	if err != nil {
		return "", err
	}

	key, ok := tok.(string)
	if !ok {
		return "", errors.New("json feed key must be a string")
	}

	return key, nil
}

func validateJSONFeedTrailer(decoder *json.Decoder, version string) error {
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return errors.New("trailing data after json feed")
	}

	if !isSupportedJSONFeedVersion(version) {
		return errors.New("unsupported json feed version")
	}

	return nil
}

func isSupportedJSONFeedVersion(version string) bool {
	switch strings.ToLower(version) {
	case "https://jsonfeed.org/version/1",
		"https://jsonfeed.org/version/1.1",
		"http://jsonfeed.org/version/1",
		"http://jsonfeed.org/version/1.1":
		return true
	default:
		return false
	}
}

func decodeJSONFeedField(decoder *json.Decoder, state *jsonFeedDecodeState, key string, maxItems int) error {
	switch key {
	case "version":
		return decoder.Decode(&state.feed.Version)
	case "title":
		return decoder.Decode(&state.feed.Title)
	case "description":
		return decoder.Decode(&state.feed.Description)
	case "icon":
		return decodeJSONFeedString(decoder, &state.feed.Icon)
	case "favicon":
		return decodeJSONFeedString(decoder, &state.feed.Favicon)
	case "home_page_url":
		return decodeJSONFeedString(decoder, &state.feed.HomePageURL)
	case "authors":
		return validateJSONAuthors(decoder)
	case "items":
		if state.seenItems {
			return errors.New("duplicate json feed items key")
		}

		state.seenItems = true

		items, err := decodeJSONFeedItems(decoder, maxItems)
		if err != nil {
			return err
		}

		state.feed.Items = items

		return nil
	default:
		return skipJSONValue(decoder, 0)
	}
}

func validateJSONAuthors(decoder *json.Decoder) error {
	tok, err := decoder.Token()
	if err != nil {
		return err
	}

	if tok == nil {
		return nil
	}

	if tok != json.Delim('[') {
		return errors.New("json feed authors must be an array")
	}

	for i := 0; decoder.More(); i++ {
		var author *gofeedjson.Author
		if err := decoder.Decode(&author); err != nil {
			return err
		}

		if author == nil {
			return fmt.Errorf("gofeed: JSON feed authors[%d] must not be null", i)
		}
	}

	return expectJSONDelimiter(decoder, ']', "unexpected end of json feed authors")
}

func decodeJSONFeedItems(decoder *json.Decoder, maxItems int) ([]*gofeedjson.Item, error) {
	tok, err := decoder.Token()
	if err != nil {
		return nil, err
	}

	if tok == nil {
		return nil, nil
	}

	if tok != json.Delim('[') {
		return nil, errors.New("json feed items must be an array")
	}

	var items []*gofeedjson.Item
	for decoder.More() {
		if len(items) >= maxItems {
			return nil, fmt.Errorf("feed item count exceeds limit %d", maxItems)
		}

		item, err := decodeJSONItem(decoder, len(items))
		if err != nil {
			return nil, err
		}

		items = append(items, item)
	}

	if err := expectJSONDelimiter(decoder, ']', "unexpected end of json feed items"); err != nil {
		return nil, err
	}

	return items, nil
}

func decodeJSONItem(decoder *json.Decoder, index int) (*gofeedjson.Item, error) {
	var item *gofeedjson.Item
	if err := decoder.Decode(&item); err != nil {
		return nil, err
	}

	if item == nil {
		return nil, fmt.Errorf("gofeed: JSON feed items[%d] must not be null", index)
	}

	for j, author := range item.Authors {
		if author == nil {
			return nil, fmt.Errorf("gofeed: JSON feed items[%d].authors[%d] must not be null", index, j)
		}
	}

	return item, nil
}

func skipJSONValue(decoder *json.Decoder, depth int) error {
	for {
		tok, err := decoder.Token()
		if err != nil {
			return err
		}

		done, err := advanceJSONSkipDepth(tok, &depth)
		if err != nil || done {
			return err
		}
	}
}

func advanceJSONSkipDepth(tok json.Token, depth *int) (bool, error) {
	delim, ok := tok.(json.Delim)
	if !ok {
		return *depth == 0, nil
	}

	switch delim {
	case '{', '[':
		*depth++
		if *depth > maxFeedJSONDepth {
			return false, fmt.Errorf("json nesting depth exceeds limit %d", maxFeedJSONDepth)
		}

		return false, nil
	case '}', ']':
		*depth--
		if *depth < 0 {
			return false, errors.New("unexpected json delimiter")
		}

		return *depth == 0, nil
	default:
		return false, errors.New("unexpected json delimiter")
	}
}

type xmlPayloadValidator struct {
	scan         payloadScan
	maxItems     int
	itemCount    int
	depth        int
	inChannel    bool
	entryDepth   int
	summaryFound bool
	contentFound bool
}

func validateXMLPayload(payload []byte, maxItems int) (payloadScan, error) {
	decoder := xml.NewDecoder(bytes.NewReader(payload))
	decoder.CharsetReader = charset.NewReaderLabel
	validator := xmlPayloadValidator{maxItems: maxItems}

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
	if v.depth > maxFeedXMLDepth {
		return fmt.Errorf("xml nesting depth exceeds limit %d", maxFeedXMLDepth)
	}

	if err := v.countFeedItem(element); err != nil {
		return err
	}

	if v.isRSSChannel(element) {
		v.inChannel = true
	}

	v.trackAtomEntry(element)

	return nil
}

func (v *xmlPayloadValidator) countFeedItem(element xml.StartElement) error {
	if !v.isFeedItem(element) {
		return nil
	}

	v.itemCount++
	if v.itemCount > v.maxItems {
		return fmt.Errorf("feed item count exceeds limit %d", v.maxItems)
	}

	return nil
}

func (v *xmlPayloadValidator) isFeedItem(element xml.StartElement) bool {
	if strings.EqualFold(v.scan.root, "feed") {
		return v.isNewAtomEntry(element)
	}

	if !strings.EqualFold(element.Name.Local, "item") {
		return false
	}

	return v.depth == 2 || (v.depth == 3 && v.inChannel)
}

func (v *xmlPayloadValidator) isRSSChannel(element xml.StartElement) bool {
	return !strings.EqualFold(v.scan.root, "feed") && v.depth == 2 && strings.EqualFold(element.Name.Local, "channel")
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

	if v.depth == 2 {
		v.inChannel = false
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

const maxFeedURLBytes = 2048

func feedURLCandidate(base *url.URL, candidates ...string) *string {
	for _, raw := range candidates {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" || len(trimmed) > maxFeedURLBytes {
			continue
		}

		resolved, err := base.Parse(trimmed)
		if err != nil {
			continue
		}

		normalized, err := domain.ParseNormalizedURL(resolved.String(), domain.ErrFeedParserError)
		if err != nil || normalized.HasCredentials() || len(normalized.Raw()) > maxFeedURLBytes {
			continue
		}

		candidate := normalized.Raw()

		return &candidate
	}

	return nil
}

func rssFeedIcon(feed *rss.Feed) string {
	if feed.Image == nil {
		return ""
	}

	return feed.Image.URL
}

func decodeJSONFeedString(decoder *json.Decoder, target *string) error {
	tok, err := decoder.Token()
	if err != nil {
		return err
	}

	switch value := tok.(type) {
	case string:
		*target = value
	case json.Delim:
		depth := 0
		if _, err := advanceJSONSkipDepth(tok, &depth); err != nil {
			return err
		}

		return skipJSONValue(decoder, depth)
	}

	return nil
}
