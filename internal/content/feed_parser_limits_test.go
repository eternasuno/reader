package content

import (
	"fmt"
	"reader/internal/domain"
	"strings"
	"testing"
)

func TestParseFeedRejectsExcessiveXMLDepth(t *testing.T) {
	t.Parallel()

	buildDeepRSS := func(extraDepth int) string {
		openTags := strings.Repeat("<ext:wrap>", extraDepth)
		closeTags := strings.Repeat("</ext:wrap>", extraDepth)

		return `<?xml version="1.0" encoding="UTF-8"?>` +
			`<rss version="2.0" xmlns:ext="https://example.com/ext"><channel><title>Deep</title>` +
			`<item><title>Item</title><link>https://example.com/1</link>` +
			openTags + `<ext:leaf>x</ext:leaf>` + closeTags +
			`</item></channel></rss>`
	}

	parser := NewFeedParser(NewSanitizer())

	// Depth = rss(1) -> channel(2) -> item(3) -> 60 wraps(63) -> leaf(64) fits maxFeedXMLDepth(64).
	if _, err := parser.ParseFeed([]byte(buildDeepRSS(60)), "https://example.com/feed.xml"); err != nil {
		t.Fatalf("expected depth 64 to succeed, got %v", err)
	}

	// Depth = 65 exceeds maxFeedXMLDepth(64).
	if _, err := parser.ParseFeed([]byte(buildDeepRSS(61)), "https://example.com/feed.xml"); err == nil {
		t.Fatal("expected depth 65 to fail, got nil")
	} else {
		requireErrorCode(t, err, domain.ErrFeedParserError)
	}
}

func TestParseFeedLimitsItemCount(t *testing.T) {
	t.Parallel()

	parser := NewFeedParser(NewSanitizer())
	limits := feedLimits{maxItems: 3, maxOutputBytes: 64 * 1024}

	t.Run("rss", func(t *testing.T) {
		var items strings.Builder
		for i := range 4 {
			fmt.Fprintf(&items, `<item><title>Item %d</title><link>https://example.com/%d</link></item>`, i, i)
		}

		body := `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Feed</title>` + items.String() + `</channel></rss>`
		parsed, err := parser.parseFeedWithLimits([]byte(body), "https://example.com/feed.xml", limits)
		requireErrorCode(t, err, domain.ErrFeedParserError)

		if len(parsed.Entries) != 0 {
			t.Fatalf("expected zero partial entries on failure, got %d", len(parsed.Entries))
		}
	})

	t.Run("atom", func(t *testing.T) {
		var entries strings.Builder
		for i := range 4 {
			fmt.Fprintf(&entries, `<entry><title>Item %d</title><link href="https://example.com/%d"/></entry>`, i, i)
		}

		body := `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Feed</title>` + entries.String() + `</feed>`
		parsed, err := parser.parseFeedWithLimits([]byte(body), "https://example.com/atom.xml", limits)
		requireErrorCode(t, err, domain.ErrFeedParserError)

		if len(parsed.Entries) != 0 {
			t.Fatalf("expected zero partial entries on failure, got %d", len(parsed.Entries))
		}
	})

	t.Run("json", func(t *testing.T) {
		var items []string
		for i := range 4 {
			items = append(items, fmt.Sprintf(`{"url":"https://example.com/%d","title":"Item %d"}`, i, i))
		}

		body := `{"version":"https://jsonfeed.org/version/1.1","title":"Feed","items":[` + strings.Join(items, ",") + `]}`
		parsed, err := parser.parseFeedWithLimits([]byte(body), "https://example.com/feed.json", limits)
		requireErrorCode(t, err, domain.ErrFeedParserError)

		if len(parsed.Entries) != 0 {
			t.Fatalf("expected zero partial entries on failure, got %d", len(parsed.Entries))
		}
	})
}

func TestParseJSONFeedAbortsEarlyOnItemLimit(t *testing.T) {
	t.Parallel()

	parser := NewFeedParser(NewSanitizer())
	base := parseBaseURL("https://example.com/feed.json")

	const totalItems = 100_000
	for _, maxItems := range []int{3, maxFeedItems} {
		t.Run(fmt.Sprintf("maxItems_%d", maxItems), func(t *testing.T) {
			t.Parallel()

			reader := newStreamingJSONFeedReader(totalItems)
			limits := feedLimits{maxItems: maxItems, maxOutputBytes: maxFeedOutputBytes}

			parsed, err := parser.parseJSONFeedReader(reader, base, limits)
			requireErrorCode(t, err, domain.ErrFeedParserError)

			if len(parsed.Entries) != 0 {
				t.Fatalf("expected zero partial entries on failure, got %d", len(parsed.Entries))
			}

			if reader.itemsEmitted > maxItems+64 {
				t.Fatalf("expected streaming abort near limit %d, but reader emitted %d of %d items", maxItems, reader.itemsEmitted, totalItems)
			}

			if reader.bytesRead >= 128*1024 {
				t.Fatalf("expected bounded read before abort, read %d bytes", reader.bytesRead)
			}
		})
	}
}

func TestParseJSONFeedEdgeCases(t *testing.T) {
	t.Parallel()

	parser := NewFeedParser(NewSanitizer())

	t.Run("items before header fields", func(t *testing.T) {
		t.Parallel()

		body := `{"items":[{"url":"https://example.com/1","title":"One"}],"description":"Desc","title":"Before Header","version":"https://jsonfeed.org/version/1.1"}`
		feed, err := parser.ParseFeed([]byte(body), "https://example.com/feed.json")
		if err != nil {
			t.Fatalf("ParseFeed failed: %v", err)
		}

		if feed.Title != "Before Header" || feed.Description == nil || *feed.Description != "Desc" || len(feed.Entries) != 1 {
			t.Fatalf("unexpected parsed feed: %+v", feed)
		}
	})

	t.Run("null items array", func(t *testing.T) {
		t.Parallel()

		body := `{"version":"https://jsonfeed.org/version/1.1","title":"Empty","items":null}`
		feed, err := parser.ParseFeed([]byte(body), "https://example.com/feed.json")
		if err != nil {
			t.Fatalf("ParseFeed failed: %v", err)
		}

		if len(feed.Entries) != 0 {
			t.Fatalf("expected 0 entries, got %d", len(feed.Entries))
		}
	})

	t.Run("skips unknown nested fields", func(t *testing.T) {
		t.Parallel()

		body := `{"version":"https://jsonfeed.org/version/1.1","title":"Ext","expired":true,"authors":[{"name":"Alice"}],"_ext":{"nested":[1,true,{"k":"v"}]},"items":[{"url":"https://example.com/1","title":"One"}]}`
		feed, err := parser.ParseFeed([]byte(body), "https://example.com/feed.json")
		if err != nil {
			t.Fatalf("ParseFeed failed: %v", err)
		}

		if len(feed.Entries) != 1 {
			t.Fatalf("expected 1 entry, got %d", len(feed.Entries))
		}
	})

	t.Run("rejects null item element and non-array items", func(t *testing.T) {
		t.Parallel()

		for _, body := range []string{
			`{"version":"https://jsonfeed.org/version/1.1","title":"Bad","items":[null]}`,
			`{"version":"https://jsonfeed.org/version/1.1","title":"Bad","items":"oops"}`,
			`{"version":"https://jsonfeed.org/version/1.1","title":"Bad","authors":[null],"items":[]}`,
		} {
			_, err := parser.ParseFeed([]byte(body), "https://example.com/feed.json")
			requireErrorCode(t, err, domain.ErrFeedParserError)
		}
	})
}

func TestParseFeedCumulativeOutputBudgetFailsWholeFeed(t *testing.T) {
	t.Parallel()

	var items strings.Builder
	chunk := `<p>` + strings.Repeat("a", 120) + `</p>`
	for i := range 5 {
		fmt.Fprintf(
			&items,
			`<item><title>Item %d</title><link>https://example.com/%d</link><description><![CDATA[%s]]></description></item>`,
			i,
			i,
			chunk,
		)
	}

	body := `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Feed</title>` + items.String() + `</channel></rss>`

	t.Run("concrete sanitizer", func(t *testing.T) {
		parser := NewFeedParser(NewSanitizer())
		// Each item alone fits 400 bytes, but 5 items cumulatively exceed 400 bytes.
		parsed, err := parser.parseFeedWithLimits([]byte(body), "https://example.com/feed.xml", feedLimits{
			maxItems:       10,
			maxOutputBytes: 400,
		})
		requireErrorCode(t, err, domain.ErrFeedParserError)

		if len(parsed.Entries) != 0 {
			t.Fatalf("expected zero partial entries, got %d", len(parsed.Entries))
		}
	})

	t.Run("custom sanitizer interface", func(t *testing.T) {
		parser := NewFeedParser(failingSanitizer{failOn: "never"})
		parsed, err := parser.parseFeedWithLimits([]byte(body), "https://example.com/feed.xml", feedLimits{
			maxItems:       10,
			maxOutputBytes: 80,
		})
		requireErrorCode(t, err, domain.ErrFeedParserError)

		if len(parsed.Entries) != 0 {
			t.Fatalf("expected zero partial entries, got %d", len(parsed.Entries))
		}
	})
}

func TestParseJSONFeedRejectsExcessiveUnknownFieldDepth(t *testing.T) {
	t.Parallel()

	parser := NewFeedParser(NewSanitizer())

	buildNestedObjectFeed := func(depth int) string {
		openBraces := strings.Repeat(`{"a":`, depth)
		closeBraces := strings.Repeat(`}`, depth)

		return `{"version":"https://jsonfeed.org/version/1.1","title":"Deep","_ext":` + openBraces + `1` + closeBraces + `,"items":[]}`
	}

	buildNestedArrayFeed := func(depth int) string {
		openBrackets := strings.Repeat(`[`, depth)
		closeBrackets := strings.Repeat(`]`, depth)

		return `{"version":"https://jsonfeed.org/version/1.1","title":"Deep","_ext":` + openBrackets + `1` + closeBrackets + `,"items":[]}`
	}

	if _, err := parser.ParseFeed([]byte(buildNestedObjectFeed(maxFeedJSONDepth)), "https://example.com/feed.json"); err != nil {
		t.Fatalf("expected depth %d to succeed, got %v", maxFeedJSONDepth, err)
	}

	for _, testCase := range []struct {
		name string
		body string
	}{
		{name: "object depth max+1", body: buildNestedObjectFeed(maxFeedJSONDepth + 1)},
		{name: "array depth max+1", body: buildNestedArrayFeed(maxFeedJSONDepth + 1)},
		{name: "very deep object", body: buildNestedObjectFeed(5000)},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			_, err := parser.ParseFeed([]byte(testCase.body), "https://example.com/feed.json")
			requireErrorCode(t, err, domain.ErrFeedParserError)
		})
	}
}

func TestParseFeedNonUTF8Encodings(t *testing.T) {
	t.Parallel()

	parser := NewFeedParser(NewSanitizer())

	t.Run("iso-8859-1 rss", func(t *testing.T) {
		t.Parallel()

		body := "<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?>\n" +
			"<rss version=\"2.0\"><channel>" +
			"<title>Caf\xe9 Feed</title>" +
			"<item><title>M\xfcnchen</title><link>https://example.com/cafe</link><description>Cr\xe8me br\xfbl\xe9e</description></item>" +
			"</channel></rss>"

		feed, err := parser.ParseFeed([]byte(body), "https://example.com/feed.xml")
		if err != nil {
			t.Fatalf("expected ISO-8859-1 feed to parse, got %v", err)
		}

		if feed.Title != "Café Feed" {
			t.Fatalf("expected title %q, got %q", "Café Feed", feed.Title)
		}

		if len(feed.Entries) != 1 || feed.Entries[0].Title != "München" {
			t.Fatalf("unexpected entries: %+v", feed.Entries)
		}

		if feed.Entries[0].Description == nil || *feed.Entries[0].Description != "Crème brûlée" {
			t.Fatalf("expected decoded description, got %v", feed.Entries[0].Description)
		}
	})

	t.Run("gbk atom", func(t *testing.T) {
		t.Parallel()

		body := "<?xml version=\"1.0\" encoding=\"GBK\"?>\n" +
			"<feed xmlns=\"http://www.w3.org/2005/Atom\">" +
			"<title>\xd6\xd0\xce\xc4</title>" +
			"<entry><title>\xb2\xe2\xca\xd4</title><link rel=\"alternate\" href=\"https://example.com/gbk\"/><summary type=\"text\">\xd6\xd0\xce\xc4\xb2\xe2\xca\xd4</summary></entry>" +
			"</feed>"

		feed, err := parser.ParseFeed([]byte(body), "https://example.com/atom.xml")
		if err != nil {
			t.Fatalf("expected GBK feed to parse, got %v", err)
		}

		if feed.Title != "中文" {
			t.Fatalf("expected title %q, got %q", "中文", feed.Title)
		}

		if len(feed.Entries) != 1 || feed.Entries[0].Title != "测试" {
			t.Fatalf("unexpected entries: %+v", feed.Entries)
		}

		if feed.Entries[0].Description == nil || *feed.Entries[0].Description != "中文测试" {
			t.Fatalf("expected decoded description, got %v", feed.Entries[0].Description)
		}
	})

	t.Run("unsupported charset and item limit still enforced", func(t *testing.T) {
		t.Parallel()

		unknownCharset := `<?xml version="1.0" encoding="NO-SUCH-CHARSET"?><rss version="2.0"><channel><title>X</title></channel></rss>`
		_, err := parser.ParseFeed([]byte(unknownCharset), "https://example.com/feed.xml")
		requireErrorCode(t, err, domain.ErrFeedParserError)

		isoTooMany := "<?xml version=\"1.0\" encoding=\"ISO-8859-1\"?><rss version=\"2.0\"><channel><title>Caf\xe9</title>" +
			"<item><title>1</title><link>https://example.com/1</link></item>" +
			"<item><title>2</title><link>https://example.com/2</link></item>" +
			"</channel></rss>"
		_, err = parser.parseFeedWithLimits([]byte(isoTooMany), "https://example.com/feed.xml", feedLimits{maxItems: 1, maxOutputBytes: 64 * 1024})
		requireErrorCode(t, err, domain.ErrFeedParserError)
	})
}

func TestParseJSONFeedAuthorsStreaming(t *testing.T) {
	t.Parallel()

	parser := NewFeedParser(NewSanitizer())

	for _, valid := range []struct {
		name string
		body string
	}{
		{name: "null authors", body: `{"version":"https://jsonfeed.org/version/1.1","title":"OK","authors":null,"items":[]}`},
		{name: "empty authors", body: `{"version":"https://jsonfeed.org/version/1.1","title":"OK","authors":[],"items":[]}`},
		{name: "multiple valid authors", body: `{"version":"https://jsonfeed.org/version/1.1","title":"OK","authors":[{"name":"Alice"},{"name":"Bob","url":"https://example.com/bob"}],"items":[]}`},
		{name: "many streamed authors", body: `{"version":"https://jsonfeed.org/version/1.1","title":"OK","authors":[` + strings.TrimSuffix(strings.Repeat(`{"name":"Author"},`, 2000), ",") + `],"items":[]}`},
	} {
		t.Run(valid.name, func(t *testing.T) {
			t.Parallel()

			if _, err := parser.ParseFeed([]byte(valid.body), "https://example.com/feed.json"); err != nil {
				t.Fatalf("expected valid authors to parse, got %v", err)
			}
		})
	}

	for _, invalid := range []struct {
		name string
		body string
	}{
		{name: "non-array authors", body: `{"version":"https://jsonfeed.org/version/1.1","title":"Bad","authors":"oops","items":[]}`},
		{name: "second author null", body: `{"version":"https://jsonfeed.org/version/1.1","title":"Bad","authors":[{"name":"Alice"},null],"items":[]}`},
		{name: "malformed author field", body: `{"version":"https://jsonfeed.org/version/1.1","title":"Bad","authors":[{"name":123}],"items":[]}`},
		{name: "truncated authors array", body: `{"version":"https://jsonfeed.org/version/1.1","title":"Bad","authors":[{"name":"Alice"}`},
	} {
		t.Run(invalid.name, func(t *testing.T) {
			t.Parallel()

			_, err := parser.ParseFeed([]byte(invalid.body), "https://example.com/feed.json")
			requireErrorCode(t, err, domain.ErrFeedParserError)
		})
	}
}

func TestParseJSONFeedRejectsDuplicateItemsKey(t *testing.T) {
	t.Parallel()

	parser := NewFeedParser(NewSanitizer())

	for _, testCase := range []struct {
		name string
		body string
	}{
		{
			name: "two populated items arrays",
			body: `{"version":"https://jsonfeed.org/version/1.1","title":"Dup","items":[{"url":"https://example.com/1","title":"One"}],"items":[{"url":"https://example.com/2","title":"Two"}]}`,
		},
		{
			name: "null then populated items",
			body: `{"version":"https://jsonfeed.org/version/1.1","title":"Dup","items":null,"items":[{"url":"https://example.com/2","title":"Two"}]}`,
		},
		{
			name: "empty then populated items",
			body: `{"version":"https://jsonfeed.org/version/1.1","title":"Dup","items":[],"items":[{"url":"https://example.com/2","title":"Two"}]}`,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			_, err := parser.parseFeedWithLimits([]byte(testCase.body), "https://example.com/feed.json", feedLimits{
				maxItems:       1,
				maxOutputBytes: 64 * 1024,
			})
			requireErrorCode(t, err, domain.ErrFeedParserError)
		})
	}

	t.Run("rejects duplicate items key before decoding value", func(t *testing.T) {
		t.Parallel()

		// Duplicate "items" key is followed by an unclosed/invalid value; rejecting on
		// key encounter avoids reading/decoding the duplicate array.
		body := `{"version":"https://jsonfeed.org/version/1.1","title":"Dup","items":[{"url":"https://example.com/1","title":"One"}],"items":[`
		_, err := parser.ParseFeed([]byte(body), "https://example.com/feed.json")
		requireErrorCode(t, err, domain.ErrFeedParserError)

		if err == nil || !strings.Contains(err.Error(), "duplicate") {
			t.Fatalf("expected duplicate items key error before decoding value, got %v", err)
		}
	})
}

func TestParseJSONFeedVersionValidation(t *testing.T) {
	t.Parallel()

	parser := NewFeedParser(NewSanitizer())

	for _, version := range []string{
		"https://jsonfeed.org/version/1",
		"https://jsonfeed.org/version/1.1",
		"http://jsonfeed.org/version/1",
		"http://jsonfeed.org/version/1.1",
	} {
		t.Run("valid_"+version, func(t *testing.T) {
			t.Parallel()

			body := fmt.Sprintf(`{"version":%q,"title":"Feed","items":[]}`, version)
			if _, err := parser.ParseFeed([]byte(body), "https://example.com/feed.json"); err != nil {
				t.Fatalf("expected version %q to be accepted, got %v", version, err)
			}
		})
	}

	for _, version := range []string{
		"",
		"1.0",
		"https://jsonfeed.org/version/",
		"https://jsonfeed.org/version/1/",
		"https://jsonfeed.org/version/1.1/extra",
		"https://jsonfeed.org/version/1.1 ",
		"https://jsonfeed.org/version/2",
		"https://evil.example/?q=jsonfeed.org/version/1.1",
		"not jsonfeed.org/version/1",
	} {
		t.Run("invalid_"+version, func(t *testing.T) {
			t.Parallel()

			body := fmt.Sprintf(`{"version":%q,"title":"Feed","items":[]}`, version)
			_, err := parser.ParseFeed([]byte(body), "https://example.com/feed.json")
			requireErrorCode(t, err, domain.ErrFeedParserError)
		})
	}
}
