package content

import (
	"strings"
	"testing"
)

func TestSanitizeHTMLSecurityVectors(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name     string
		raw      string
		unwanted string
	}{
		{"script", `<p>safe<script>alert(1)</script></p>`, "<script"},
		{"iframe", `<p>safe<iframe src="https://evil.example/"></iframe></p>`, "<iframe"},
		{"javascript link", `<a href="javascript:alert(1)">safe</a>`, "javascript:"},
		{"vbscript image", `<img src="vbscript:msgbox(1)">`, "vbscript:"},
		{"html data image", `<img src="data:text/html;base64,PHNjcmlwdD4=">`, "data:text/html"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			got, err := NewSanitizer().SanitizeHTML(tc.raw, "https://example.com/")
			if err != nil {
				t.Fatalf("sanitize: %v", err)
			}

			requireNotContains(t, got, tc.unwanted)
		})
	}
	t.Run("combined markup", func(t *testing.T) {
		t.Parallel()
		raw := `<div><p>Hello <script>alert("x")</script><style>p{color:red}</style></p>` +
			`<img src="/images/pic.png" alt="pic" loading="lazy" onerror="alert(1)" onload="alert(2)">` +
			`<iframe src="https://evil.example/"></iframe>` +
			`<form action="/submit"><input name="field"><button>Go</button></form>` +
			`<object data="clip.swf"></object><embed src="clip.swf">` +
			`<svg><circle r="1"></circle></svg>` +
			`<figure><figcaption>Caption</figcaption><picture><source src="/images/pic.webp" type="image/webp"><img src="/images/pic.png" alt="pic" width="120" height="80"></picture></figure>` +
			`<table><tbody><tr><td>cell</td></tr></tbody></table><pre><code>code</code></pre>` +
			`<a href="javascript:alert(1)">bad link</a></div>`

		sanitized, err := NewSanitizer().SanitizeHTML(raw, "https://example.com/blog/article")
		if err != nil {
			t.Fatalf("expected sanitize to succeed, got %v", err)
		}

		for _, unwanted := range []string{
			"<script",
			"alert(",
			"<style",
			"<iframe",
			"<form",
			"<input",
			"<button",
			"<object",
			"<embed",
			"<svg",
			"onerror",
			"onload",
			"javascript:",
		} {
			requireNotContains(t, sanitized, unwanted)
		}

		requireContains(t, sanitized, `<img src="https://example.com/images/pic.png"`)
		requireContains(t, sanitized, `loading="lazy"`)
		requireContains(t, sanitized, `bad link`)
		requireContains(t, sanitized, `<figure><figcaption>Caption</figcaption>`)
		requireContains(t, sanitized, `width="120"`)
		requireContains(t, sanitized, `height="80"`)
		requireContains(t, sanitized, `<td>cell</td>`)
		requireContains(t, sanitized, `<code>code</code>`)
	})
}

func TestSanitizeHTMLResolvesAndRewritesURLs(t *testing.T) {
	t.Parallel()

	raw := `<a href="/posts/one">relative</a>` +
		`<a href="https://elsewhere.example/x">absolute</a>` +
		`<a href="mailto:someone@example.com">mail</a>` +
		`<a href="/overridden" target="_self" rel="nofollow">override</a>` +
		`<a href="javascript:alert(1)">bad</a>` +
		`<img src="img/pic.png">` +
		`<img src="data:image/png;base64,iVBORw0KGgo=">` +
		`<img src="data:text/html;base64,PHNjcmlwdD4=">` +
		`<video src="media/clip.mp4" controls></video>` +
		`<picture><source src="media/pic.webp" type="image/webp"><img src="media/pic.png" alt="pic"></picture>`

	sanitized, err := NewSanitizer().SanitizeHTML(raw, "https://example.com/blog/article")
	if err != nil {
		t.Fatalf("expected sanitize to succeed, got %v", err)
	}

	requireContains(t, sanitized, `<a href="https://example.com/posts/one" target="_blank" rel="noopener noreferrer">relative</a>`)
	requireContains(t, sanitized, `<a href="https://elsewhere.example/x" target="_blank" rel="noopener noreferrer">absolute</a>`)
	requireContains(t, sanitized, `<a href="mailto:someone@example.com" target="_blank" rel="noopener noreferrer">mail</a>`)
	requireContains(t, sanitized, `<a href="https://example.com/overridden"`)
	requireNotContains(t, sanitized, "_self")
	requireNotContains(t, sanitized, "nofollow")
	requireNotContains(t, sanitized, "javascript:")
	requireContains(t, sanitized, `<img src="https://example.com/blog/img/pic.png"`)
	requireContains(t, sanitized, `<img src="data:image/png;base64,iVBORw0KGgo="`)
	requireNotContains(t, sanitized, "data:text/html")
	requireContains(t, sanitized, `<video src="https://example.com/blog/media/clip.mp4" controls="">`)
	requireContains(t, sanitized, `<picture>`)
	requireContains(t, sanitized, `<source src="https://example.com/blog/media/pic.webp" type="image/webp"`)
}

func TestSanitizeHTMLStripsURLCredentials(t *testing.T) {
	t.Parallel()

	raw := `<a href="sub">relative</a>` +
		`<img src="pic.png">` +
		`<a href="https://u:p@other.example/x">absolute</a>` +
		`<img src="https://media:pw@other.example/pic.png">`

	sanitized, err := NewSanitizer().SanitizeHTML(raw, "https://user:secret@example.com/dir/page.html")
	if err != nil {
		t.Fatalf("expected sanitize to succeed, got %v", err)
	}

	requireContains(t, sanitized, `<a href="https://example.com/dir/sub"`)
	requireContains(t, sanitized, `<img src="https://example.com/dir/pic.png"`)
	requireContains(t, sanitized, `<a href="https://other.example/x"`)
	requireContains(t, sanitized, `<img src="https://other.example/pic.png"`)

	for _, credential := range []string{"user:", "secret@", "u:p@", "media:pw@", "@example.com", "@other.example"} {
		requireNotContains(t, sanitized, credential)
	}
}

func TestSanitizeHTMLReturnsEmptyForBlankInput(t *testing.T) {
	t.Parallel()

	sanitized, err := NewSanitizer().SanitizeHTML("   ", "https://example.com/")
	if err != nil {
		t.Fatalf("expected sanitize to succeed, got %v", err)
	}

	if sanitized != "" {
		t.Fatalf("expected empty sanitized html, got %q", sanitized)
	}
}

func TestSanitizeHTMLBudgetAndXSSVectors(t *testing.T) {
	t.Parallel()

	sanitizer := NewSanitizer()

	// Relative URL expansion exceeding budget fails cleanly.
	raw := strings.Repeat(`<a href="/x">link</a>`, 20)
	longBase := "https://example.com/" + strings.Repeat("a", 64) + "/"
	if _, err := sanitizer.sanitizeHTMLWithBudget(raw, longBase, 512); err == nil {
		t.Fatal("expected budget overflow error, got nil")
	}

	// XSS vectors remain stripped with single bluemonday pass.
	xss := `<p>ok</p><svg><script>alert(1)</script></svg><math><mtext></mtext></math>` +
		`<noscript><img src=x onerror=alert(2)></noscript>` +
		`<a href="javascript:alert(3)" onclick="alert(4)">click</a>` +
		`<img src="vbscript:msgbox(1)">` +
		`<a href="https://example.com/good" onmouseover="alert(5)">good</a>`
	sanitized, err := sanitizer.SanitizeHTML(xss, "https://example.com/")
	if err != nil {
		t.Fatalf("SanitizeHTML() error = %v", err)
	}

	for _, vector := range []string{"<script", "<svg", "<math", "<noscript", "onerror", "onclick", "onmouseover", "javascript:", "vbscript:", "alert("} {
		requireNotContains(t, sanitized, vector)
	}

	requireContains(t, sanitized, `<a href="https://example.com/good" target="_blank" rel="noopener noreferrer">good</a>`)
}

func TestSanitizeHTMLRemovesUnusedURLAttrsAndRestrictsDataURLs(t *testing.T) {
	t.Parallel()

	raw := `<map name="m"><area shape="rect" coords="0,0,10,10" href="https://user:pw@example.com/area"></map>` +
		`<img src="/pic.png" usemap="#m">` +
		`<blockquote cite="https://user:pw@example.com/quote"><p>quote</p></blockquote>` +
		`<q cite="https://user:pw@example.com/q">short</q>` +
		`<del cite="https://user:pw@example.com/del">old</del>` +
		`<ins cite="https://user:pw@example.com/ins">new</ins>` +
		`<a href="data:image/png;base64,iVBORw0KGgo=">data link</a>` +
		`<video src="data:image/png;base64,iVBORw0KGgo=" controls></video>` +
		`<audio src="data:image/png;base64,iVBORw0KGgo=" controls></audio>` +
		`<picture><source src="data:image/png;base64,iVBORw0KGgo=" type="image/png"><img src="data:image/png;base64,iVBORw0KGgo="></picture>` +
		`<a href="mailto://user:pw@example.com">bad mailto</a>` +
		`<source src="https://media:pw@example.com/clip.mp4" type="video/mp4">` +
		`<video src="https://vid:pw@example.com/clip.mp4"></video>` +
		`<audio src="https://aud:pw@example.com/clip.mp3"></audio>`

	sanitized, err := NewSanitizer().SanitizeHTML(raw, "https://baseuser:basepw@example.com/dir/post")
	if err != nil {
		t.Fatalf("SanitizeHTML() error = %v", err)
	}

	for _, unwanted := range []string{
		"<map",
		"<area",
		"usemap",
		"cite=",
		"user:",
		"pw@",
		"baseuser:",
		"basepw@",
		"media:",
		"vid:",
		"aud:",
		`<a href="data:`,
		`<video src="data:`,
		`<audio src="data:`,
		`<source src="data:`,
		"mailto://",
	} {
		requireNotContains(t, sanitized, unwanted)
	}

	requireContains(t, sanitized, "<blockquote><p>quote</p></blockquote>")
	requireContains(t, sanitized, "<q>short</q>")
	requireContains(t, sanitized, "<del>old</del>")
	requireContains(t, sanitized, "<ins>new</ins>")
	requireContains(t, sanitized, `<img src="https://example.com/pic.png"`)
	requireContains(t, sanitized, `<img src="data:image/png;base64,iVBORw0KGgo="`)
	requireContains(t, sanitized, `<video src="https://example.com/clip.mp4"`)
	requireContains(t, sanitized, `<audio src="https://example.com/clip.mp3"`)
}
