package content

import (
	"strings"
	"testing"
)

func TestParseFeedIconURL(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
		want string
	}{
		{
			name: "rss channel image",
			body: `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><image><url>/logo.png</url><title>T</title><link>https://example.com/</link></image></channel></rss>`,
			want: "https://example.com/logo.png",
		},
		{
			name: "atom icon wins over logo",
			body: `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><icon>https://cdn.example.com/i.png</icon><logo>https://cdn.example.com/l.png</logo></feed>`,
			want: "https://cdn.example.com/i.png",
		},
		{
			name: "json favicon wins over icon",
			body: `{"version":"https://jsonfeed.org/version/1.1","title":"T","icon":"https://example.com/big.png","favicon":"https://example.com/small.png","items":[]}`,
			want: "https://example.com/small.png",
		},
		{
			name: "credentials and non-http schemes are dropped",
			body: `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><image><url>https://user:pw@example.com/logo.png</url></image></channel></rss>`,
			want: "",
		},
		{
			name: "invalid port falls back to next candidate",
			body: `{"version":"https://jsonfeed.org/version/1.1","title":"T","favicon":"https://example.com:65536/a.png","icon":"https://example.com/b.png","items":[]}`,
			want: "https://example.com/b.png",
		},
		{
			name: "resolved url over the byte limit is dropped",
			body: `{"version":"https://jsonfeed.org/version/1.1","title":"T","favicon":"/` + strings.Repeat("a", 2040) + `","icon":"https://example.com/b.png","items":[]}`,
			want: "https://example.com/b.png",
		},
		{
			name: "non-string icon value is ignored",
			body: `{"version":"https://jsonfeed.org/version/1.1","title":"T","favicon":{"a":[1,2]},"icon":"https://example.com/b.png","items":[]}`,
			want: "https://example.com/b.png",
		},
		{
			name: "missing image",
			body: `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title></channel></rss>`,
			want: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			parsed, err := NewFeedParser(NewSanitizer()).ParseFeed([]byte(tc.body), "https://example.com/feed")
			if err != nil {
				t.Fatalf("ParseFeed() error = %v", err)
			}

			got := ""
			if parsed.IconURL != nil {
				got = *parsed.IconURL
			}

			if got != tc.want {
				t.Fatalf("IconURL = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestParseFeedIconRejectsDeeplyNestedValue(t *testing.T) {
	t.Parallel()

	nested := strings.Repeat("[", 100) + strings.Repeat("]", 100)
	body := `{"version":"https://jsonfeed.org/version/1.1","title":"T","icon":` + nested + `,"items":[]}`

	if _, err := NewFeedParser(NewSanitizer()).ParseFeed([]byte(body), "https://example.com/feed"); err == nil {
		t.Fatal("ParseFeed() error = nil, want nesting depth error")
	}
}
