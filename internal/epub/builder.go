package epub

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"

	"reader/internal/domain"
)

const (
	defaultImageConcurrency = 4
	minImageCacheBytes      = 64 << 20
	maxEPUBImageWidth       = 1200
	maxEPUBImageHeight      = 1600
	imageReencodeMinBytes   = 128 << 10
	maxImageDecodeDimension = 8192
	maxImageDecodePixels    = 25_000_000
	epubJPEGQuality         = 75
	epubMimetype            = "application/epub+zip"
	bookCreator             = "留白"
	untitledArticle         = "Untitled"
	chapterSourcePrefix     = "chapters/"
	oebpsPrefix             = "OEBPS/"
	imagesPrefix            = "OEBPS/images/"
	xmlDeclaration          = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
	xhtmlOpenTag            = "<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"zh-CN\" lang=\"zh-CN\">\n"
	containerXML            = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`
	stylesCSS = `body {
  font-family: serif;
  line-height: 1.6;
  margin: 1.5em;
}

h1 {
  font-size: 1.5em;
  line-height: 1.3;
  margin: 0 0 0.5em;
}

h2 {
  font-size: 1.25em;
  margin: 1.2em 0 0.5em;
}

p {
  margin: 0 0 0.8em;
}

pre {
  overflow-x: auto;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

code {
  font-family: monospace;
  font-size: 0.9em;
}

blockquote {
  border-left: 3px solid #cccccc;
  color: #555555;
  margin: 1em 0;
  padding: 0 1em;
}

img {
  max-width: 100%;
  height: auto;
}

.article-meta {
  color: #666666;
  font-size: 0.85em;
  margin-bottom: 1.5em;
}
`
)

var voidElements = map[string]struct{}{
	"area":   {},
	"base":   {},
	"br":     {},
	"col":    {},
	"embed":  {},
	"hr":     {},
	"img":    {},
	"input":  {},
	"link":   {},
	"meta":   {},
	"param":  {},
	"source": {},
	"track":  {},
	"wbr":    {},
}

type Config struct {
	ImageFetcher     domain.ImageFetcher
	MaxEPUBBytes     int
	ImageConcurrency int
}

type Builder struct {
	imageFetcher     domain.ImageFetcher
	maxEPUBBytes     int
	imageConcurrency int
}

type epubDraft struct {
	chapters   []chapter
	images     []embeddedImage
	identifier string
	modifiedAt time.Time
}

type chapter struct {
	article domain.KindleArticle
	root    *html.Node
}

type embeddedImage struct {
	Number    int
	Extension string
	MediaType string
	Data      []byte
}

type imageResult struct {
	Data      []byte
	Extension string
	OK        bool
}

type cachedImageResult struct {
	asset imageResult
	ok    bool
}

type imageCache struct {
	mu            sync.Mutex
	entries       map[string]cachedImageResult
	maxImageBytes int
	maxTotalBytes int
	totalBytes    int
}

type zipEntry struct {
	name   string
	method uint16
	body   []byte
}

func NewBuilder(cfg Config) *Builder {
	maxEPUBBytes := cfg.MaxEPUBBytes
	if maxEPUBBytes <= 0 {
		maxEPUBBytes = domain.MaxKindleEPUBBytes
	}

	imageConcurrency := cfg.ImageConcurrency
	if imageConcurrency <= 0 {
		imageConcurrency = defaultImageConcurrency
	}

	return &Builder{
		imageFetcher:     cfg.ImageFetcher,
		maxEPUBBytes:     maxEPUBBytes,
		imageConcurrency: imageConcurrency,
	}
}

func (b *Builder) BuildBooks(ctx context.Context, dateStr string, articles []domain.KindleArticle) ([]domain.EPUBBook, error) {
	if len(articles) == 0 {
		return nil, nil
	}

	cache := newImageCache(b.maxEPUBBytes)
	measurementTitle := measurementBookTitle(dateStr, len(articles))

	drafts, err := domain.SplitKindleChunks(articles, b.maxEPUBBytes, func(chunk []domain.KindleArticle, textOnly bool) (epubDraft, int, error) {
		draft, err := b.buildDraft(ctx, chunk, !textOnly, cache)
		if err != nil {
			return epubDraft{}, 0, err
		}

		measured, err := renderEPUB(measurementTitle, draft)
		if err != nil {
			return epubDraft{}, 0, err
		}

		return draft, len(measured), nil
	})
	if err != nil {
		return nil, err
	}

	return b.renderNumberedBooks(ctx, dateStr, drafts, cache)
}

func (b *Builder) renderNumberedBooks(
	ctx context.Context,
	dateStr string,
	drafts []epubDraft,
	cache *imageCache,
) ([]domain.EPUBBook, error) {
	current := drafts
	for {
		books, splitIndex, err := b.tryRenderBooks(ctx, dateStr, current, cache)
		if err != nil {
			return nil, err
		}

		if splitIndex < 0 {
			return books, nil
		}

		current, err = b.splitDraftAt(ctx, current, splitIndex, cache)
		if err != nil {
			return nil, err
		}
	}
}

func (b *Builder) tryRenderBooks(
	ctx context.Context,
	dateStr string,
	drafts []epubDraft,
	cache *imageCache,
) ([]domain.EPUBBook, int, error) {
	books := make([]domain.EPUBBook, len(drafts))
	for i, draft := range drafts {
		title, filename := domain.FormatKindleBookMeta(dateStr, i+1, len(drafts))
		finalDraft, data, overflowMulti, err := b.renderBook(ctx, draft, title, cache)
		if err != nil {
			return nil, -1, err
		}

		if overflowMulti {
			return nil, i, nil
		}

		books[i] = domain.EPUBBook{
			Title:        title,
			Filename:     filename,
			Data:         data,
			SavedPageIDs: finalDraft.savedPageIDs(),
			FeedItemIDs:  finalDraft.feedItemIDs(),
			ArticleCount: len(finalDraft.chapters),
		}
	}

	return books, -1, nil
}

func (b *Builder) splitDraftAt(
	ctx context.Context,
	drafts []epubDraft,
	splitIndex int,
	cache *imageCache,
) ([]epubDraft, error) {
	leftArticles, rightArticles := domain.HalveKindleArticles(drafts[splitIndex].articles())
	leftDraft, err := b.buildDraft(ctx, leftArticles, true, cache)
	if err != nil {
		return nil, err
	}

	rightDraft, err := b.buildDraft(ctx, rightArticles, true, cache)
	if err != nil {
		return nil, err
	}

	nextDrafts := make([]epubDraft, 0, len(drafts)+1)
	nextDrafts = append(nextDrafts, drafts[:splitIndex]...)
	nextDrafts = append(nextDrafts, leftDraft, rightDraft)
	nextDrafts = append(nextDrafts, drafts[splitIndex+1:]...)

	return nextDrafts, nil
}

func measurementBookTitle(dateStr string, articleCount int) string {
	title, _ := domain.FormatKindleBookMeta(dateStr, articleCount, articleCount)

	return title
}

func (b *Builder) renderBook(
	ctx context.Context,
	draft epubDraft,
	title string,
	cache *imageCache,
) (epubDraft, []byte, bool, error) {
	data, err := renderEPUB(title, draft)
	if err != nil {
		return epubDraft{}, nil, false, err
	}

	if len(data) <= b.maxEPUBBytes {
		return draft, data, false, nil
	}

	if len(draft.chapters) > 1 {
		return epubDraft{}, nil, true, nil
	}

	if len(draft.images) == 0 {
		return epubDraft{}, nil, false, fmt.Errorf("kindle book %q is %d bytes, exceeding the %d byte limit", title, len(data), b.maxEPUBBytes)
	}

	return b.renderBookWithoutImages(ctx, draft, title, cache)
}

func (b *Builder) renderBookWithoutImages(
	ctx context.Context,
	draft epubDraft,
	title string,
	cache *imageCache,
) (epubDraft, []byte, bool, error) {
	textOnlyDraft, err := b.buildDraft(ctx, draft.articles(), false, cache)
	if err != nil {
		return epubDraft{}, nil, false, err
	}

	textOnlyDraft.identifier = draft.identifier
	textOnlyDraft.modifiedAt = draft.modifiedAt

	data, err := renderEPUB(title, textOnlyDraft)
	if err != nil {
		return epubDraft{}, nil, false, err
	}

	if len(data) > b.maxEPUBBytes {
		return epubDraft{}, nil, false, fmt.Errorf("kindle article %q is %d bytes even without images, exceeding the %d byte limit", textOnlyDraft.chapters[0].article.ID, len(data), b.maxEPUBBytes)
	}

	return textOnlyDraft, data, false, nil
}

func (b *Builder) buildDraft(ctx context.Context, articles []domain.KindleArticle, includeImages bool, cache *imageCache) (epubDraft, error) {
	chapters := make([]chapter, len(articles))
	for i, article := range articles {
		parsed, err := newChapter(article)
		if err != nil {
			return epubDraft{}, err
		}

		chapters[i] = parsed
	}

	return epubDraft{
		chapters:   chapters,
		images:     b.prepareImages(ctx, chapters, includeImages, cache),
		identifier: "urn:uuid:" + uuid.NewString(),
		modifiedAt: time.Now(),
	}, nil
}

func newChapter(article domain.KindleArticle) (chapter, error) {
	context := &html.Node{Type: html.ElementNode, Data: "div", DataAtom: atom.Div}
	nodes, err := html.ParseFragment(strings.NewReader(article.HTMLBody), context)
	if err != nil {
		return chapter{}, fmt.Errorf("parse article html: %s", domain.SanitizeErrorText(err.Error()))
	}

	root := &html.Node{Type: html.ElementNode, Data: "div", DataAtom: atom.Div}
	for _, node := range nodes {
		root.AppendChild(node)
	}

	return chapter{article: article, root: root}, nil
}

func (b *Builder) prepareImages(ctx context.Context, chapters []chapter, includeImages bool, cache *imageCache) []embeddedImage {
	nodeURLs, orderedURLs := collectImageTargets(chapters)

	var images []embeddedImage
	var rewrites map[string]string
	if includeImages && b.imageFetcher != nil {
		images, rewrites = b.buildEmbeddedImages(ctx, orderedURLs, cache)
	}

	rewriteChapterImages(chapters, nodeURLs, rewrites)

	return images
}

func collectImageTargets(chapters []chapter) (map[*html.Node]string, []string) {
	nodeURLs := make(map[*html.Node]string)
	orderedURLs := make([]string, 0)
	seenURLs := make(map[string]struct{})

	for _, ch := range chapters {
		for _, node := range imageNodes(ch.root) {
			resolved := resolveImageURL(ch.article.URL, nodeAttr(node, "src"))
			if resolved == "" {
				continue
			}

			nodeURLs[node] = resolved
			if _, ok := seenURLs[resolved]; ok {
				continue
			}

			seenURLs[resolved] = struct{}{}
			orderedURLs = append(orderedURLs, resolved)
		}
	}

	return nodeURLs, orderedURLs
}

func (b *Builder) buildEmbeddedImages(
	ctx context.Context,
	orderedURLs []string,
	cache *imageCache,
) ([]embeddedImage, map[string]string) {
	results := b.fetchImages(ctx, orderedURLs, cache)
	images := make([]embeddedImage, 0, len(orderedURLs))
	rewrites := make(map[string]string, len(orderedURLs))

	for i, rawURL := range orderedURLs {
		if !results[i].ok {
			continue
		}

		image := embeddedImage{
			Number:    len(images) + 1,
			Extension: results[i].asset.Extension,
			MediaType: imageMediaType(results[i].asset.Extension),
			Data:      results[i].asset.Data,
		}
		images = append(images, image)
		rewrites[rawURL] = "../images/" + image.fileName()
	}

	return images, rewrites
}

func rewriteChapterImages(chapters []chapter, nodeURLs map[*html.Node]string, rewrites map[string]string) {
	for _, ch := range chapters {
		for _, node := range imageNodes(ch.root) {
			if source, ok := rewrites[nodeURLs[node]]; ok {
				setAttr(node, "src", source)
				continue
			}

			removeNode(node)
		}
	}
}

func (b *Builder) fetchImages(ctx context.Context, urls []string, cache *imageCache) []cachedImageResult {
	results := make([]cachedImageResult, len(urls))
	pending := make([]int, 0, len(urls))
	for i, rawURL := range urls {
		if cached, ok := cache.load(rawURL); ok {
			results[i] = cached
			continue
		}

		pending = append(pending, i)
	}

	queue := newIndexQueue(pending)

	var waitGroup sync.WaitGroup
	for range min(b.imageConcurrency, len(pending)) {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			b.fetchImageWorker(ctx, queue, urls, results, cache)
		}()
	}

	waitGroup.Wait()

	return results
}

func newIndexQueue(indices []int) <-chan int {
	queue := make(chan int, len(indices))
	for _, index := range indices {
		queue <- index
	}

	close(queue)

	return queue
}

func (b *Builder) fetchImageWorker(
	ctx context.Context,
	queue <-chan int,
	urls []string,
	results []cachedImageResult,
	cache *imageCache,
) {
	for index := range queue {
		if ctx.Err() != nil {
			return
		}

		result := b.fetchImage(ctx, urls[index])
		results[index] = cache.store(urls[index], result)
	}
}

func (b *Builder) fetchImage(ctx context.Context, rawURL string) imageResult {
	data, mediaType, _, err := b.imageFetcher.FetchImage(ctx, rawURL)
	if err != nil || len(data) == 0 {
		return imageResult{}
	}

	extension, ok := imageExtension(mediaType)
	if !ok {
		return imageResult{}
	}

	data, extension = optimizeImage(data, extension)

	return imageResult{Data: data, Extension: extension, OK: true}
}

func optimizeImage(data []byte, extension string) ([]byte, string) {
	if extension != ".jpg" && extension != ".png" {
		return data, extension
	}

	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || !shouldOptimizeImage(cfg, len(data)) {
		return data, extension
	}

	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data, extension
	}

	targetW, targetH := fitImageDimensions(cfg.Width, cfg.Height)
	dst := resampleOntoWhite(src, targetW, targetH)

	var encoded bytes.Buffer
	if err := jpeg.Encode(&encoded, dst, &jpeg.Options{Quality: epubJPEGQuality}); err != nil {
		return data, extension
	}

	if encoded.Len() >= len(data) {
		return data, extension
	}

	return encoded.Bytes(), ".jpg"
}

func shouldOptimizeImage(cfg image.Config, byteLen int) bool {
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return false
	}

	if cfg.Width > maxImageDecodeDimension || cfg.Height > maxImageDecodeDimension {
		return false
	}

	if cfg.Width*cfg.Height > maxImageDecodePixels {
		return false
	}

	return cfg.Width > maxEPUBImageWidth || cfg.Height > maxEPUBImageHeight || byteLen > imageReencodeMinBytes
}

func fitImageDimensions(width int, height int) (int, int) {
	targetW := width
	targetH := height

	if targetW > maxEPUBImageWidth {
		targetH = max(1, (targetH*maxEPUBImageWidth)/targetW)
		targetW = maxEPUBImageWidth
	}

	if targetH > maxEPUBImageHeight {
		targetW = max(1, (targetW*maxEPUBImageHeight)/targetH)
		targetH = maxEPUBImageHeight
	}

	return targetW, targetH
}

func resampleOntoWhite(src image.Image, dstW int, dstH int) *image.RGBA {
	bounds := src.Bounds()
	srcW := bounds.Dx()
	srcH := bounds.Dy()
	dst := image.NewRGBA(image.Rect(0, 0, dstW, dstH))

	for y := range dstH {
		srcY := bounds.Min.Y + ((2*y+1)*srcH)/(2*dstH)
		rowOffset := y * dst.Stride

		for x := range dstW {
			srcX := bounds.Min.X + ((2*x+1)*srcW)/(2*dstW)
			r, g, b, a := src.At(srcX, srcY).RGBA()
			white := uint32(0xffff) - a
			pix := dst.Pix[rowOffset+x*4 : rowOffset+x*4+4]
			pix[0] = uint8((r + white) >> 8)
			pix[1] = uint8((g + white) >> 8)
			pix[2] = uint8((b + white) >> 8)
			pix[3] = 0xff
		}
	}

	return dst
}

func newImageCache(maxEPUBBytes int) *imageCache {
	return &imageCache{
		entries:       make(map[string]cachedImageResult),
		maxImageBytes: maxEPUBBytes,
		maxTotalBytes: max(3*maxEPUBBytes, minImageCacheBytes),
	}
}

func (c *imageCache) load(rawURL string) (cachedImageResult, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	result, ok := c.entries[rawURL]

	return result, ok
}

func (c *imageCache) store(rawURL string, result imageResult) cachedImageResult {
	c.mu.Lock()
	defer c.mu.Unlock()

	if existing, ok := c.entries[rawURL]; ok {
		return existing
	}

	if result.OK && !c.accepts(result) {
		result = imageResult{}
	}

	if result.OK {
		c.totalBytes += len(result.Data)
	}

	stored := cachedImageResult{asset: result, ok: result.OK}
	c.entries[rawURL] = stored

	return stored
}

func (c *imageCache) accepts(result imageResult) bool {
	return len(result.Data) <= c.maxImageBytes && c.totalBytes+len(result.Data) <= c.maxTotalBytes
}

func (d epubDraft) articles() []domain.KindleArticle {
	articles := make([]domain.KindleArticle, len(d.chapters))
	for i, ch := range d.chapters {
		articles[i] = ch.article
	}

	return articles
}

func (d epubDraft) savedPageIDs() []string {
	ids := make([]string, 0, len(d.chapters))
	for _, ch := range d.chapters {
		if ch.article.IsSavedPage {
			ids = append(ids, ch.article.ID)
		}
	}

	return ids
}

func (d epubDraft) feedItemIDs() []string {
	ids := make([]string, 0, len(d.chapters))
	for _, ch := range d.chapters {
		if !ch.article.IsSavedPage {
			ids = append(ids, ch.article.ID)
		}
	}

	return ids
}

func (img embeddedImage) fileName() string {
	return fmt.Sprintf("img-%04d%s", img.Number, img.Extension)
}

func imageExtension(mediaType string) (string, bool) {
	if separator := strings.IndexByte(mediaType, ';'); separator >= 0 {
		mediaType = mediaType[:separator]
	}

	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case "image/jpeg":
		return ".jpg", true
	case "image/png":
		return ".png", true
	case "image/gif":
		return ".gif", true
	default:
		return "", false
	}
}

func imageMediaType(extension string) string {
	switch extension {
	case ".jpg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	default:
		return ""
	}
}

func resolveImageURL(baseURL string, rawURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return ""
	}

	base, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return ""
	}

	reference, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}

	resolved := base.ResolveReference(reference)
	if resolved.Scheme != "http" && resolved.Scheme != "https" {
		return ""
	}

	return resolved.String()
}

func imageNodes(root *html.Node) []*html.Node {
	nodes := make([]*html.Node, 0)
	collectImageNodes(root, &nodes)

	return nodes
}

func collectImageNodes(parent *html.Node, nodes *[]*html.Node) {
	for child := parent.FirstChild; child != nil; child = child.NextSibling {
		if child.Type == html.ElementNode && child.Data == "img" {
			*nodes = append(*nodes, child)
		}

		collectImageNodes(child, nodes)
	}
}

func nodeAttr(node *html.Node, key string) string {
	for _, attr := range node.Attr {
		if attr.Key == key {
			return attr.Val
		}
	}

	return ""
}

func setAttr(node *html.Node, key string, value string) {
	for i := range node.Attr {
		if node.Attr[i].Key == key {
			node.Attr[i].Val = value
			return
		}
	}

	node.Attr = append(node.Attr, html.Attribute{Key: key, Val: value})
}

func removeNode(node *html.Node) {
	if node.Parent == nil {
		return
	}

	node.Parent.RemoveChild(node)
}

func renderEPUB(title string, draft epubDraft) ([]byte, error) {
	chapterDocs := make([][]byte, len(draft.chapters))
	for i, ch := range draft.chapters {
		chapterDocs[i] = renderChapter(ch)
	}

	entries := make([]zipEntry, 0, 6+len(chapterDocs)+len(draft.images))

	entries = append(entries,
		zipEntry{name: "mimetype", method: zip.Store, body: []byte(epubMimetype)},
		zipEntry{name: "META-INF/container.xml", method: zip.Deflate, body: []byte(containerXML)},
		zipEntry{name: "OEBPS/styles.css", method: zip.Deflate, body: []byte(stylesCSS)},
		zipEntry{name: "OEBPS/nav.xhtml", method: zip.Deflate, body: renderNav(title, draft.chapters)},
		zipEntry{name: "OEBPS/toc.ncx", method: zip.Deflate, body: renderNCX(title, draft)},
	)

	for i, doc := range chapterDocs {
		entries = append(entries, zipEntry{name: oebpsPrefix + chapterHref(i), method: zip.Deflate, body: doc})
	}

	for _, image := range draft.images {
		entries = append(entries, zipEntry{name: imagesPrefix + image.fileName(), method: zip.Deflate, body: image.Data})
	}

	entries = append(entries, zipEntry{name: "OEBPS/content.opf", method: zip.Deflate, body: renderOPF(title, draft)})

	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, entry := range entries {
		if err := writeZipEntry(writer, entry.name, entry.method, entry.body); err != nil {
			return nil, err
		}
	}

	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("close epub archive: %s", domain.SanitizeErrorText(err.Error()))
	}

	return buffer.Bytes(), nil
}

func writeZipEntry(writer *zip.Writer, name string, method uint16, body []byte) error {
	entry, err := writer.CreateHeader(&zip.FileHeader{Name: name, Method: method})
	if err != nil {
		return fmt.Errorf("create epub entry %q: %s", name, domain.SanitizeErrorText(err.Error()))
	}

	if _, err := entry.Write(body); err != nil {
		return fmt.Errorf("write epub entry %q: %s", name, domain.SanitizeErrorText(err.Error()))
	}

	return nil
}

func renderChapter(ch chapter) []byte {
	title := chapterTitle(ch.article)

	var out strings.Builder
	out.WriteString(xmlDeclaration)
	out.WriteString("<!DOCTYPE html>\n")
	out.WriteString(xhtmlOpenTag)
	out.WriteString("<head>\n<title>")
	writeEscapedText(&out, title)
	out.WriteString("</title>\n<link rel=\"stylesheet\" type=\"text/css\" href=\"../styles.css\"/>\n</head>\n<body>\n<h1>")
	writeEscapedText(&out, title)
	out.WriteString("</h1>\n")
	writeChapterMeta(&out, ch.article)
	out.WriteString("<div class=\"article-content\">")
	writeChildren(&out, ch.root)
	out.WriteString("</div>\n</body>\n</html>\n")

	return []byte(out.String())
}

func writeChapterMeta(out *strings.Builder, article domain.KindleArticle) {
	parts := make([]string, 0, 3)

	if sourceTitle := strings.TrimSpace(article.SourceTitle); sourceTitle != "" {
		parts = append(parts, escapeXMLText(sourceTitle))
	}

	if article.PublishedAt != nil {
		parts = append(parts, escapeXMLText(article.PublishedAt.Format("2006-01-02 15:04")))
	}

	if articleURL := strings.TrimSpace(article.URL); articleURL != "" {
		parts = append(parts, "<a href=\""+escapeXMLAttr(articleURL)+"\">原文链接</a>")
	}

	if len(parts) == 0 {
		return
	}

	out.WriteString("<p class=\"article-meta\">" + strings.Join(parts, " · ") + "</p>\n")
}

func renderNav(title string, chapters []chapter) []byte {
	var out strings.Builder
	out.WriteString(xmlDeclaration)
	out.WriteString("<!DOCTYPE html>\n")
	out.WriteString(xhtmlOpenTag)
	out.WriteString("<head>\n<meta charset=\"utf-8\"/>\n<title>")
	writeEscapedText(&out, title)
	out.WriteString("</title>\n</head>\n<body>\n<nav epub:type=\"toc\" id=\"toc\">\n<h1>目录</h1>\n<ol>\n")

	for i, ch := range chapters {
		out.WriteString("<li><a href=\"" + chapterHref(i) + "\">" + escapeXMLText(chapterTitle(ch.article)) + "</a></li>\n")
	}

	out.WriteString("</ol>\n</nav>\n</body>\n</html>\n")

	return []byte(out.String())
}

func renderNCX(title string, draft epubDraft) []byte {
	var out strings.Builder
	out.WriteString(xmlDeclaration)
	out.WriteString("<ncx xmlns=\"http://www.daisy.org/z3986/2005/ncx/\" version=\"2005-1\">\n")
	out.WriteString("<head>\n<meta name=\"dtb:uid\" content=\"" + escapeXMLAttr(draft.identifier) + "\"/>\n")
	out.WriteString("<meta name=\"dtb:depth\" content=\"1\"/>\n")
	out.WriteString("<meta name=\"dtb:totalPageCount\" content=\"0\"/>\n")
	out.WriteString("<meta name=\"dtb:maxPageNumber\" content=\"0\"/>\n</head>\n")
	out.WriteString("<docTitle><text>" + escapeXMLText(title) + "</text></docTitle>\n<navMap>\n")

	for i, ch := range draft.chapters {
		_, _ = fmt.Fprintf(&out, "<navPoint id=\"navPoint-%04d\" playOrder=\"%d\">\n", i+1, i+1)
		out.WriteString("<navLabel><text>" + escapeXMLText(chapterTitle(ch.article)) + "</text></navLabel>\n")
		out.WriteString("<content src=\"" + chapterHref(i) + "\"/>\n</navPoint>\n")
	}

	out.WriteString("</navMap>\n</ncx>\n")

	return []byte(out.String())
}

func renderOPF(title string, draft epubDraft) []byte {
	var out strings.Builder
	out.WriteString(xmlDeclaration)
	out.WriteString("<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"book-id\">\n")
	out.WriteString("<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n")
	out.WriteString("<dc:identifier id=\"book-id\">" + escapeXMLText(draft.identifier) + "</dc:identifier>\n")
	out.WriteString("<dc:title>" + escapeXMLText(title) + "</dc:title>\n")
	out.WriteString("<dc:language>zh-CN</dc:language>\n")
	out.WriteString("<dc:creator>" + escapeXMLText(bookCreator) + "</dc:creator>\n")
	out.WriteString("<meta property=\"dcterms:modified\">" + draft.modifiedAt.UTC().Format("2006-01-02T15:04:05Z") + "</meta>\n")
	out.WriteString("</metadata>\n<manifest>\n")
	out.WriteString("<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n")
	out.WriteString("<item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>\n")
	out.WriteString("<item id=\"css\" href=\"styles.css\" media-type=\"text/css\"/>\n")

	for i := range draft.chapters {
		_, _ = fmt.Fprintf(&out, "<item id=\"chapter-%04d\" href=\"%s\" media-type=\"application/xhtml+xml\"/>\n", i+1, chapterHref(i))
	}

	for _, image := range draft.images {
		_, _ = fmt.Fprintf(&out, "<item id=\"img-%04d\" href=\"images/%s\" media-type=\"%s\"/>\n", image.Number, image.fileName(), image.MediaType)
	}

	out.WriteString("</manifest>\n<spine toc=\"ncx\">\n")

	for i := range draft.chapters {
		_, _ = fmt.Fprintf(&out, "<itemref idref=\"chapter-%04d\"/>\n", i+1)
	}

	out.WriteString("</spine>\n</package>\n")

	return []byte(out.String())
}

func chapterHref(index int) string {
	return fmt.Sprintf("%schapter-%04d.xhtml", chapterSourcePrefix, index+1)
}

func chapterTitle(article domain.KindleArticle) string {
	if title := strings.TrimSpace(article.Title); title != "" {
		return title
	}

	return untitledArticle
}

func writeChildren(out *strings.Builder, parent *html.Node) {
	for child := parent.FirstChild; child != nil; child = child.NextSibling {
		writeNode(out, child)
	}
}

func writeNode(out *strings.Builder, node *html.Node) {
	switch node.Type {
	case html.TextNode:
		writeEscapedText(out, node.Data)
	case html.ElementNode:
		writeElement(out, node)
	}
}

func writeElement(out *strings.Builder, node *html.Node) {
	if !isXMLName(node.Data) {
		writeChildren(out, node)
		return
	}

	out.WriteString("<" + node.Data)
	writeAttributes(out, node.Attr)

	if _, ok := voidElements[node.Data]; ok {
		out.WriteString("/>")
		return
	}

	out.WriteString(">")
	writeChildren(out, node)
	out.WriteString("</" + node.Data + ">")
}

func writeAttributes(out *strings.Builder, attrs []html.Attribute) {
	for _, attr := range attrs {
		if !isXMLName(attr.Key) {
			continue
		}

		out.WriteString(" " + attr.Key + "=\"")
		writeEscapedAttr(out, attr.Val)
		out.WriteString("\"")
	}
}

func writeEscapedText(out *strings.Builder, text string) {
	for _, r := range text {
		switch r {
		case '&':
			out.WriteString("&amp;")
		case '<':
			out.WriteString("&lt;")
		case '>':
			out.WriteString("&gt;")
		default:
			if isXMLChar(r) {
				out.WriteRune(r)
			}
		}
	}
}

func writeEscapedAttr(out *strings.Builder, text string) {
	for _, r := range text {
		switch r {
		case '&':
			out.WriteString("&amp;")
		case '<':
			out.WriteString("&lt;")
		case '>':
			out.WriteString("&gt;")
		case '"':
			out.WriteString("&quot;")
		case '\t':
			out.WriteString("&#9;")
		case '\n':
			out.WriteString("&#10;")
		case '\r':
			out.WriteString("&#13;")
		default:
			if isXMLChar(r) {
				out.WriteRune(r)
			}
		}
	}
}

func escapeXMLText(text string) string {
	var out strings.Builder
	writeEscapedText(&out, text)

	return out.String()
}

func escapeXMLAttr(text string) string {
	var out strings.Builder
	writeEscapedAttr(&out, text)

	return out.String()
}

func isXMLChar(r rune) bool {
	return r == '\t' || r == '\n' || r == '\r' || (r >= 0x20 && r <= 0xD7FF) || (r >= 0xE000 && r <= 0xFFFD) || (r >= 0x10000 && r <= 0x10FFFF)
}

func isXMLName(name string) bool {
	if name == "" {
		return false
	}

	for i, r := range name {
		if i == 0 {
			if !isXMLNameStartChar(r) {
				return false
			}

			continue
		}

		if !isXMLNameChar(r) {
			return false
		}
	}

	return true
}

func isXMLNameStartChar(r rune) bool {
	return isASCIILetter(r) || r == '_'
}

func isXMLNameChar(r rune) bool {
	return isXMLNameStartChar(r) || isASCIIDigit(r) || r == '-' || r == '.' || r == ':'
}

func isASCIILetter(r rune) bool {
	return (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
}

func isASCIIDigit(r rune) bool {
	return r >= '0' && r <= '9'
}
