package domain

import (
	"bytes"
	"cmp"
	"encoding/xml"
	"errors"
	"io"
	"slices"
	"strings"
)

const (
	maxOPMLOutlines = 2000
	maxOPMLDepth    = 64
)

type opmlXMLDocument struct {
	XMLName xml.Name     `xml:"opml"`
	Version string       `xml:"version,attr"`
	Body    *opmlXMLBody `xml:"body"`
}

type opmlXMLBody struct {
	Outlines []opmlXMLOutline `xml:"outline"`
}

type opmlXMLOutline struct {
	Attrs    []xml.Attr       `xml:",any,attr"`
	Outlines []opmlXMLOutline `xml:"outline"`
}

type opmlWalkState struct {
	document    OPMLDocument
	seenFeeds   map[string]struct{}
	seenFolders map[string]struct{}
}

func ParseOPML(data []byte) (OPMLDocument, error) {
	return parseOPMLWithLimit(data, maxOPMLOutlines)
}

func parseOPMLWithLimit(data []byte, maxOutlines int) (OPMLDocument, error) {
	payload := bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf})
	if err := validateOPMLPayload(payload, maxOutlines); err != nil {
		return OPMLDocument{}, err
	}

	parsed := opmlXMLDocument{}
	decoder := xml.NewDecoder(bytes.NewReader(payload))
	if err := opmlDecodeRoot(decoder, payload, &parsed); err != nil {
		return OPMLDocument{}, err
	}

	if parsed.Body == nil {
		return OPMLDocument{}, NewError(ErrInvalidOpml, errors.New("opml body is missing"))
	}

	if err := opmlCheckTrailing(decoder, payload); err != nil {
		return OPMLDocument{}, err
	}

	state := opmlWalkState{
		seenFeeds:   make(map[string]struct{}, len(parsed.Body.Outlines)),
		seenFolders: make(map[string]struct{}, len(parsed.Body.Outlines)),
	}
	state.walk(parsed.Body.Outlines, nil)

	return state.document, nil
}

type opmlTokenValidator struct {
	maxOutlines int
	outlines    int
	depth       int
}

func validateOPMLPayload(payload []byte, maxOutlines int) error {
	decoder := xml.NewDecoder(bytes.NewReader(payload))
	validator := opmlTokenValidator{maxOutlines: maxOutlines}

	for {
		tok, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			return nil
		}

		if err != nil {
			return NewError(ErrInvalidOpml, err)
		}

		if err := validator.handleToken(tok); err != nil {
			return err
		}
	}
}

func (v *opmlTokenValidator) handleToken(tok xml.Token) error {
	switch typed := tok.(type) {
	case xml.StartElement:
		v.depth++
		if v.depth > maxOPMLDepth {
			return NewError(ErrInvalidOpml, errors.New("opml nesting depth exceeds limit"))
		}

		if strings.EqualFold(typed.Name.Local, "outline") {
			v.outlines++
			if v.outlines > v.maxOutlines {
				return NewError(ErrInvalidOpml, errors.New("opml outline count exceeds limit"))
			}
		}
	case xml.EndElement:
		v.depth--
	}

	return nil
}

func (s *opmlWalkState) walk(outlines []opmlXMLOutline, folder *string) {
	for _, outline := range outlines {
		s.processOutline(outline, folder)
	}
}

func (s *opmlWalkState) processOutline(outline opmlXMLOutline, folder *string) {
	rawXMLURL, hasXMLURL := opmlAttribute(outline.Attrs, "xmlUrl")
	if hasXMLURL {
		s.addFeed(outline, rawXMLURL, folder)
		s.walk(outline.Outlines, folder)

		return
	}

	if isInvalidEmptyRSSOutline(outline) {
		// A feed outline without any url is invalid; it must not become a folder.
		s.document.SkippedInvalid++
		return
	}

	s.walk(outline.Outlines, opmlFolderName(outline, folder, &s.document, s.seenFolders))
}

func isInvalidEmptyRSSOutline(outline opmlXMLOutline) bool {
	outlineType, _ := opmlAttribute(outline.Attrs, "type")

	return strings.EqualFold(strings.TrimSpace(outlineType), "rss") && len(outline.Outlines) == 0
}

func (s *opmlWalkState) addFeed(outline opmlXMLOutline, rawXMLURL string, folder *string) {
	xmlURL := strings.TrimSpace(rawXMLURL)
	if xmlURL == "" {
		s.document.SkippedInvalid++
		return
	}

	feedURL, err := ParseNormalizedURL(xmlURL, ErrFeedUrlInvalid)
	if err != nil {
		s.document.SkippedInvalid++
		return
	}

	if _, duplicate := s.seenFeeds[feedURL.Raw()]; duplicate {
		s.document.SkippedInvalid++
		return
	}

	s.seenFeeds[feedURL.Raw()] = struct{}{}
	s.document.Feeds = append(s.document.Feeds, OPMLFeedInput{
		URL:        feedURL,
		Title:      opmlFeedTitle(outline, feedURL),
		FolderName: folder,
	})
}

func opmlDecodeRoot(decoder *xml.Decoder, payload []byte, parsed *opmlXMLDocument) error {
	for {
		start := decoder.InputOffset()
		tok, err := decoder.Token()
		end := decoder.InputOffset()
		if err != nil {
			return NewError(ErrInvalidOpml, err)
		}

		done, err := opmlHandleRootToken(decoder, tok, payload[start:end], parsed)
		if err != nil || done {
			return err
		}
	}
}

func opmlHandleRootToken(decoder *xml.Decoder, tok xml.Token, raw []byte, parsed *opmlXMLDocument) (bool, error) {
	switch typed := tok.(type) {
	case xml.Comment, xml.ProcInst, xml.Directive:
		return false, nil
	case xml.CharData:
		if !isXMLWhitespacePair(typed, raw) {
			return false, NewError(ErrInvalidOpml, errors.New("unexpected content before the opml root element"))
		}
		return false, nil
	case xml.StartElement:
		return true, opmlDecodeStartElement(decoder, typed, parsed)
	default:
		return false, NewError(ErrInvalidOpml, errors.New("unexpected token before the opml root element"))
	}
}

func opmlDecodeStartElement(decoder *xml.Decoder, start xml.StartElement, parsed *opmlXMLDocument) error {
	if start.Name.Local != "opml" {
		return NewError(ErrInvalidOpml, errors.New("opml root element is missing"))
	}

	if err := decoder.DecodeElement(parsed, &start); err != nil {
		return NewError(ErrInvalidOpml, err)
	}

	return nil
}

func opmlCheckTrailing(decoder *xml.Decoder, payload []byte) error {
	for {
		start := decoder.InputOffset()
		tok, err := decoder.Token()
		end := decoder.InputOffset()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}

			return NewError(ErrInvalidOpml, err)
		}

		if err := opmlValidateTrailingToken(tok, payload[start:end]); err != nil {
			return err
		}
	}
}

func opmlValidateTrailingToken(tok xml.Token, raw []byte) error {
	switch typed := tok.(type) {
	case xml.Comment, xml.ProcInst:
		return nil
	case xml.CharData:
		if !isXMLWhitespacePair(typed, raw) {
			return NewError(ErrInvalidOpml, errors.New("unexpected content after the opml root element"))
		}
		return nil
	default:
		return NewError(ErrInvalidOpml, errors.New("unexpected element after the opml root element"))
	}
}

func isXMLWhitespacePair(charData []byte, raw []byte) bool {
	return isXMLWhitespace(charData) && isXMLWhitespace(raw)
}

func isXMLWhitespace(data []byte) bool {
	for _, b := range data {
		if b != ' ' && b != '\t' && b != '\r' && b != '\n' {
			return false
		}
	}

	return true
}

func ExportOPML(folders []OPMLExportFolder, topFeeds []Feed) ([]byte, error) {
	document := opmlXMLDocument{Version: "2.0", Body: &opmlXMLBody{}}
	for _, folder := range opmlSortedFolders(folders) {
		outline := opmlXMLOutline{Attrs: []xml.Attr{
			{Name: xml.Name{Local: "text"}, Value: folder.Name},
			{Name: xml.Name{Local: "title"}, Value: folder.Name},
		}}
		for _, feed := range folder.Feeds {
			outline.Outlines = append(outline.Outlines, opmlFeedOutline(feed))
		}

		document.Body.Outlines = append(document.Body.Outlines, outline)
	}

	for _, feed := range opmlSortedFeeds(topFeeds) {
		document.Body.Outlines = append(document.Body.Outlines, opmlFeedOutline(feed))
	}

	payload, err := xml.MarshalIndent(document, "", "  ")
	if err != nil {
		return nil, NewError(ErrInvalidOpml, err)
	}

	exported := make([]byte, 0, len(xml.Header)+len(payload)+1)
	exported = append(exported, xml.Header...)
	exported = append(exported, payload...)

	return append(exported, '\n'), nil
}

func opmlSortedFolders(folders []OPMLExportFolder) []OPMLExportFolder {
	sorted := make([]OPMLExportFolder, len(folders))
	for i, folder := range folders {
		sorted[i] = OPMLExportFolder{Name: SanitizeErrorText(folder.Name), Feeds: opmlSortedFeeds(folder.Feeds)}
	}

	slices.SortFunc(sorted, func(a, b OPMLExportFolder) int {
		return cmp.Compare(a.Name, b.Name)
	})

	return sorted
}

func opmlSortedFeeds(feeds []Feed) []Feed {
	sorted := make([]Feed, len(feeds))
	for i, feed := range feeds {
		feed.Title = SanitizeErrorText(feed.Title)
		sorted[i] = feed
	}

	slices.SortFunc(sorted, func(a, b Feed) int {
		if byTitle := cmp.Compare(a.Title, b.Title); byTitle != 0 {
			return byTitle
		}

		return cmp.Compare(a.ID, b.ID)
	})

	return sorted
}

func opmlFeedOutline(feed Feed) opmlXMLOutline {
	return opmlXMLOutline{Attrs: []xml.Attr{
		{Name: xml.Name{Local: "type"}, Value: "rss"},
		{Name: xml.Name{Local: "text"}, Value: feed.Title},
		{Name: xml.Name{Local: "title"}, Value: feed.Title},
		{Name: xml.Name{Local: "xmlUrl"}, Value: feed.URL.RedactedString()},
	}}
}

func opmlFolderName(outline opmlXMLOutline, parent *string, document *OPMLDocument, seen map[string]struct{}) *string {
	name := opmlOptionalAttribute(outline.Attrs, "text")
	if name == "" {
		name = opmlOptionalAttribute(outline.Attrs, "title")
	}

	name = SanitizeErrorText(name)
	if name == "" {
		return parent
	}

	if _, ok := seen[name]; !ok {
		seen[name] = struct{}{}
		document.Folders = append(document.Folders, name)
	}

	return &name
}

func opmlFeedTitle(outline opmlXMLOutline, feedURL NormalizedURL) string {
	title := opmlOptionalAttribute(outline.Attrs, "title")
	if title == "" {
		title = opmlOptionalAttribute(outline.Attrs, "text")
	}

	title = SanitizeErrorText(title)
	if title == "" {
		title = feedURL.Host()
	}

	return title
}

func opmlOptionalAttribute(attrs []xml.Attr, name string) string {
	value, _ := opmlAttribute(attrs, name)

	return strings.TrimSpace(value)
}

func opmlAttribute(attrs []xml.Attr, name string) (string, bool) {
	for _, attr := range attrs {
		if strings.EqualFold(attr.Name.Local, name) {
			return attr.Value, true
		}
	}

	return "", false
}
