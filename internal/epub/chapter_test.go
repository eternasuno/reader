package epub

import (
	"bytes"
	"context"
	"reader/internal/domain"
	"strings"
	"testing"
)

func TestBuildBooksSerializesChapterBodiesAsXML(t *testing.T) {
	t.Parallel()

	articles := []domain.KindleArticle{{
		ID:          "item-1",
		SourceTitle: "示例订阅源",
		URL:         "https://example.com/posts/1",
		Title:       "杂乱 HTML",
		HTMLBody: strings.Join([]string{
			`<p>a &amp; b &copy; &nbsp; &lt;tag&gt;</p>`,
			`<ul><li>one<li>two</ul>`,
			`<table><tr><td>cell</td></tr></table>`,
			`<pre><code>if (a < b) &amp;&amp; c</code></pre>`,
			`<!-- comment -->`,
			`<script>var x = "<b>";</script>`,
			`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>`,
			`<div data-x="1" :class="vue" @click="go()" title="line` + "\n" + `two">attrs</div>`,
			`<img src="data:image/png;base64,AAAA">`,
			`<video controls><source src="https://example.com/v.mp4" type="video/mp4"></video>`,
		}, ""),
	}}

	books, err := newTestBuilder(Config{}).BuildBooks(context.Background(), "2026-03-15", articles)
	if err != nil {
		t.Fatalf("BuildBooks() error = %v", err)
	}

	reader := openArchive(t, books[0].Data)
	chapter := string(entryBody(t, entryByName(t, reader, "OEBPS/chapters/chapter-0001.xhtml")))
	requireValidXML(t, "OEBPS/chapters/chapter-0001.xhtml", []byte(chapter))

	for _, want := range []string{
		`a &amp; b ©   &lt;tag&gt;`,
		`<ul><li>one</li><li>two</li></ul>`,
		`<table><tbody><tr><td>cell</td></tr></tbody></table>`,
		`<pre><code>if (a &lt; b) &amp;&amp; c</code></pre>`,
		`<script>var x = "&lt;b&gt;";</script>`,
		`<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"></circle></svg>`,
		`<div data-x="1" title="line&#10;two">attrs</div>`,
		`<source src="https://example.com/v.mp4" type="video/mp4"/>`,
	} {
		if !strings.Contains(chapter, want) {
			t.Fatalf("chapter missing %q:\n%s", want, chapter)
		}
	}

	for _, unwanted := range []string{"<!--", ":class", "@click", "<img"} {
		if strings.Contains(chapter, unwanted) {
			t.Fatalf("chapter still contains %q:\n%s", unwanted, chapter)
		}
	}
}

func TestChapterNavOpfUncompressedBytesMatchesRenderedDelta(t *testing.T) {
	t.Parallel()

	identity := newBookIdentity()
	meta := archiveMeta{
		title:    "Lantern 2026-03-15 (987654/987654)",
		locale:   bookLocales[domain.KindleLanguageChinese],
		identity: identity,
	}

	const fillerSection = "Filler"

	testCases := []struct {
		index   int
		title   string
		section string
		images  []imageManifestItem
		remote  bool
	}{
		{index: 0, title: "Plain title", section: "Read Later"},
		{index: 0, title: "Remote chapter", section: "Read Later", remote: true},
		{index: 1, title: "Same section", section: fillerSection},
		{index: 1, title: "Title & <escaped> > text", section: "Folder & <x>", images: []imageManifestItem{{number: 1, fileName: "img-0001.jpg", mediaType: "image/jpeg"}}},
		{index: 9998, title: "Four digits", section: "订阅源"},
		{index: 9999, title: "Five digits", section: "Next", images: []imageManifestItem{{number: 10000, fileName: "img-10000.png", mediaType: "image/png"}}},
		{index: 9999, title: "Five digits same section", section: fillerSection},
	}

	renderNavOpfSize := func(m archiveMeta) int {
		var buf bytes.Buffer
		if err := writeNav(&buf, m); err != nil {
			t.Fatalf("writeNav() error = %v", err)
		}

		if err := writeNCX(&buf, m); err != nil {
			t.Fatalf("writeNCX() error = %v", err)
		}

		if err := writeOPF(&buf, m); err != nil {
			t.Fatalf("writeOPF() error = %v", err)
		}

		return buf.Len()
	}

	for _, tc := range testCases {
		meta.chapters = nil
		meta.images = nil
		for len(meta.chapters) < tc.index {
			meta.chapters = append(meta.chapters, chapterMeta{title: "filler", section: fillerSection})
		}

		before := renderNavOpfSize(meta)
		ch := chapterMeta{title: tc.title, section: tc.section, hasRemoteResources: tc.remote}
		meta.chapters = append(meta.chapters, ch)
		meta.images = append(meta.images, tc.images...)
		after := renderNavOpfSize(meta)

		startsSection := tc.index == 0 || tc.section != fillerSection
		got := chapterNavOpfUncompressedBytes(tc.index, ch, startsSection, tc.images)
		want := int64(after - before)
		if got != want {
			t.Fatalf("index %d %q: chapterNavOpfUncompressedBytes() = %d, want %d", tc.index, tc.title, got, want)
		}
	}
}
