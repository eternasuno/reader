package content

import "testing"

func TestParseFeedSiteURL(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		body string
		want string
	}{
		{
			name: "rss channel link",
			body: `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><link>https://blog.example.org/</link></channel></rss>`,
			want: "https://blog.example.org/",
		},
		{
			name: "rss relative link resolves against base",
			body: `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><link>/blog/</link></channel></rss>`,
			want: "https://example.com/blog/",
		},
		{
			name: "rss link with credentials is dropped",
			body: `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><link>https://user:pw@example.com/</link></channel></rss>`,
			want: "",
		},
		{
			name: "rss missing link",
			body: `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title></channel></rss>`,
			want: "",
		},
		{
			name: "atom alternate link",
			body: `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><link rel="self" href="https://example.com/atom.xml"/><link rel="alternate" type="text/html" href="https://blog.example.org/"/></feed>`,
			want: "https://blog.example.org/",
		},
		{
			name: "atom link without rel is alternate",
			body: `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><link href="https://blog.example.org/"/></feed>`,
			want: "https://blog.example.org/",
		},
		{
			name: "atom relative alternate resolves against base",
			body: `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><link rel="alternate" href="/blog/"/></feed>`,
			want: "https://example.com/blog/",
		},
		{
			name: "atom without alternate link",
			body: `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><link rel="self" href="https://example.com/atom.xml"/></feed>`,
			want: "",
		},
		{
			name: "atom alternate with credentials is dropped",
			body: `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><link rel="alternate" href="https://user:pw@example.com/"/></feed>`,
			want: "",
		},
		{
			name: "json home page url",
			body: `{"version":"https://jsonfeed.org/version/1.1","title":"T","home_page_url":"https://blog.example.org/","items":[]}`,
			want: "https://blog.example.org/",
		},
		{
			name: "json relative home page url resolves against base",
			body: `{"version":"https://jsonfeed.org/version/1.1","title":"T","home_page_url":"/blog/","items":[]}`,
			want: "https://example.com/blog/",
		},
		{
			name: "json home page url with credentials is dropped",
			body: `{"version":"https://jsonfeed.org/version/1.1","title":"T","home_page_url":"https://user:pw@example.com/","items":[]}`,
			want: "",
		},
		{
			name: "json missing home page url",
			body: `{"version":"https://jsonfeed.org/version/1.1","title":"T","items":[]}`,
			want: "",
		},
		{
			name: "json non-string home page url is ignored",
			body: `{"version":"https://jsonfeed.org/version/1.1","title":"T","home_page_url":{"a":[1,2]},"items":[]}`,
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

			if tc.want == "" {
				if parsed.SiteURL != nil {
					t.Fatalf("SiteURL = %q, want nil", *parsed.SiteURL)
				}

				return
			}

			if parsed.SiteURL == nil {
				t.Fatalf("SiteURL = nil, want %q", tc.want)
			}

			if *parsed.SiteURL != tc.want {
				t.Fatalf("SiteURL = %q, want %q", *parsed.SiteURL, tc.want)
			}
		})
	}
}
