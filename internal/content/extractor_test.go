package content

import (
	"reader/internal/domain"
	"testing"
)

const articleFixture = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Readable article</title>
  <meta property="article:published_time" content="2020-02-03T04:05:06Z">
  <meta name="description" content="Excerpt &amp; summary of the article.">
  <meta property="og:site_name" content="Example Site">
</head>
<body>
  <header><nav><a href="/">Home</a><a href="/about">About</a></nav></header>
  <main>
    <article>
      <h1>Extracting the readable part</h1>
      <p>A first paragraph with enough words to look like real content, mentioning a <a href="/relative/link">relative link</a> inside the running text.</p>
      <p>A second paragraph that keeps the reader engaged, with enough sentences that readability keeps this block instead of discarding it as clutter, plus an illustration <img src="../images/photo.png" alt="photo"> for the reader.</p>
      <p>A third paragraph continues the story and adds detail about the subject, describing how extraction removes navigation, adverts, and other unrelated page furniture.</p>
      <p>A fourth paragraph closes the article, reminding the reader that the extracted text should keep paragraph breaks while dropping scripts and event handlers.</p>
      <script>alert("xss")</script>
    </article>
  </main>
  <footer>Footer links</footer>
</body>
</html>`

func TestExtractArticle(t *testing.T) {
	t.Parallel()

	article, err := NewArticleExtractor(NewSanitizer()).ExtractArticle(articleFixture, "https://example.com/posts/article")
	if err != nil {
		t.Fatalf("expected article to extract, got %v", err)
	}

	if article.Title != "Readable article" {
		t.Fatalf("expected article title from document title, got %q", article.Title)
	}

	requireContains(t, article.Content, `href="https://example.com/relative/link" target="_blank" rel="noopener noreferrer"`)
	requireContains(t, article.Content, `src="https://example.com/images/photo.png"`)
	requireContains(t, article.Content, "A first paragraph with enough words")
	requireNotContains(t, article.Content, "alert(")
	requireNotContains(t, article.Content, "Footer links")

	if article.Description == nil || *article.Description != "Excerpt &amp; summary of the article." {
		t.Fatalf("expected sanitized excerpt, got %v", article.Description)
	}

	requireTime(t, article.PublishedAt, "2020-02-03T04:05:06Z")
}

func TestExtractArticleRejectsEmptyContent(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		body    string
		pageURL string
		want    domain.ErrorCode
	}{
		{name: "empty body", body: "", pageURL: "https://example.com/posts/article", want: domain.ErrArticleEmptyContent},
		{name: "whitespace body", body: "  \n\t ", pageURL: "https://example.com/posts/article", want: domain.ErrArticleEmptyContent},
		{name: "no readable content", body: "<html><head><title>Empty</title></head><body></body></html>", pageURL: "https://example.com/posts/article", want: domain.ErrArticleEmptyContent},
		{name: "invalid URL", body: articleFixture, pageURL: "://invalid", want: domain.ErrArticleExtractorError},
	}

	extractor := NewArticleExtractor(NewSanitizer())

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			_, err := extractor.ExtractArticle(testCase.body, testCase.pageURL)
			requireErrorCode(t, err, testCase.want)
		})
	}
}

func TestExtractArticleRenderHTMLBound(t *testing.T) {
	t.Parallel()

	article, err := extractReadableArticle(articleFixture, "https://example.com/posts/article")
	if err != nil {
		t.Fatalf("extractReadableArticle() error = %v", err)
	}

	extractor := NewArticleExtractor(NewSanitizer())
	_, err = extractor.renderSanitizedArticleWithLimit(article, "https://example.com/posts/article", 64)
	requireErrorCode(t, err, domain.ErrArticleExtractorError)
}
