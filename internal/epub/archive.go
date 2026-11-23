package epub

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"reader/internal/domain"
)

const (
	epubMimetype        = "application/epub+zip"
	bookCreator         = "拾叶"
	chapterSourcePrefix = "chapters/"
	oebpsPrefix         = "OEBPS/"
	imagesPrefix        = "OEBPS/images/"
	xmlDeclaration      = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
	xhtmlOpenTag        = "<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"zh-CN\" lang=\"zh-CN\">\n"
	containerXML        = `<?xml version="1.0" encoding="utf-8"?>
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

type embeddedImage struct {
	number int
	asset  preparedImage
}

func (img embeddedImage) fileName() string {
	return fmt.Sprintf("img-%04d%s", img.number, img.asset.format.ext)
}

type zipEntry struct {
	name   string
	method uint16
	body   []byte
}

type archiveMeta struct {
	title      string
	identifier string
	modifiedAt time.Time
	chapters   []chapterInput
	images     []embeddedImage
}

func bookAssetPlan(chapters []chapterInput, assets map[string]preparedImage, textOnly bool) ([]embeddedImage, map[string]string) {
	if textOnly || len(assets) == 0 {
		return nil, nil
	}

	images := make([]embeddedImage, 0)
	rewrites := make(map[string]string)
	for _, ch := range chapters {
		images = appendChapterAssets(ch, assets, images, rewrites)
	}

	return images, rewrites
}

func appendChapterAssets(
	ch chapterInput,
	assets map[string]preparedImage,
	images []embeddedImage,
	rewrites map[string]string,
) []embeddedImage {
	for _, rawURL := range ch.imgURLs {
		if _, done := rewrites[rawURL]; done {
			continue
		}

		asset, ok := assets[rawURL]
		if !ok {
			continue
		}

		img := embeddedImage{number: len(images) + 1, asset: asset}
		images = append(images, img)
		rewrites[rawURL] = "../images/" + img.fileName()
	}

	return images
}

func renderEPUB(ctx context.Context, title string, chapters []chapterInput, assets map[string]preparedImage, textOnly bool) ([]byte, error) {
	images, rewrites := bookAssetPlan(chapters, assets, textOnly)
	meta := archiveMeta{
		title:      title,
		identifier: "urn:uuid:" + uuid.NewString(),
		modifiedAt: time.Now(),
		chapters:   chapters,
		images:     images,
	}

	chapterDocs, err := renderChapters(ctx, chapters, rewrites)
	if err != nil {
		return nil, err
	}

	return writeEPUBZip(ctx, buildArchiveEntries(meta, chapterDocs))
}

func renderChapters(ctx context.Context, chapters []chapterInput, rewrites map[string]string) ([][]byte, error) {
	docs := make([][]byte, len(chapters))
	for i, ch := range chapters {
		if err := ctx.Err(); err != nil {
			return nil, err
		}

		docs[i] = renderChapter(ch, rewrites)
	}

	return docs, nil
}

func buildArchiveEntries(meta archiveMeta, chapterDocs [][]byte) []zipEntry {
	entries := make([]zipEntry, 0, 6+len(chapterDocs)+len(meta.images))
	entries = append(entries,
		zipEntry{name: "mimetype", method: zip.Store, body: []byte(epubMimetype)},
		zipEntry{name: "META-INF/container.xml", method: zip.Deflate, body: []byte(containerXML)},
		zipEntry{name: "OEBPS/styles.css", method: zip.Deflate, body: []byte(stylesCSS)},
		zipEntry{name: "OEBPS/nav.xhtml", method: zip.Deflate, body: renderNav(meta.title, meta.chapters)},
		zipEntry{name: "OEBPS/toc.ncx", method: zip.Deflate, body: renderNCX(meta)},
	)

	for i, doc := range chapterDocs {
		entries = append(entries, zipEntry{name: oebpsPrefix + chapterHref(i), method: zip.Deflate, body: doc})
	}

	for _, img := range meta.images {
		entries = append(entries, zipEntry{name: imagesPrefix + img.fileName(), method: zip.Deflate, body: img.asset.data})
	}

	return append(entries, zipEntry{name: "OEBPS/content.opf", method: zip.Deflate, body: renderOPF(meta)})
}

func writeEPUBZip(ctx context.Context, entries []zipEntry) ([]byte, error) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}

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

func renderNav(title string, chapters []chapterInput) []byte {
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

func renderNCX(meta archiveMeta) []byte {
	var out strings.Builder
	out.WriteString(xmlDeclaration)
	out.WriteString("<ncx xmlns=\"http://www.daisy.org/z3986/2005/ncx/\" version=\"2005-1\">\n")
	out.WriteString("<head>\n<meta name=\"dtb:uid\" content=\"" + escapeXMLAttr(meta.identifier) + "\"/>\n")
	out.WriteString("<meta name=\"dtb:depth\" content=\"1\"/>\n")
	out.WriteString("<meta name=\"dtb:totalPageCount\" content=\"0\"/>\n")
	out.WriteString("<meta name=\"dtb:maxPageNumber\" content=\"0\"/>\n</head>\n")
	out.WriteString("<docTitle><text>" + escapeXMLText(meta.title) + "</text></docTitle>\n<navMap>\n")

	for i, ch := range meta.chapters {
		_, _ = fmt.Fprintf(&out, "<navPoint id=\"navPoint-%04d\" playOrder=\"%d\">\n", i+1, i+1)
		out.WriteString("<navLabel><text>" + escapeXMLText(chapterTitle(ch.article)) + "</text></navLabel>\n")
		out.WriteString("<content src=\"" + chapterHref(i) + "\"/>\n</navPoint>\n")
	}

	out.WriteString("</navMap>\n</ncx>\n")

	return []byte(out.String())
}

func renderOPF(meta archiveMeta) []byte {
	var out strings.Builder
	out.WriteString(xmlDeclaration)
	out.WriteString("<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"book-id\">\n")
	out.WriteString("<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n")
	out.WriteString("<dc:identifier id=\"book-id\">" + escapeXMLText(meta.identifier) + "</dc:identifier>\n")
	out.WriteString("<dc:title>" + escapeXMLText(meta.title) + "</dc:title>\n")
	out.WriteString("<dc:language>zh-CN</dc:language>\n")
	out.WriteString("<dc:creator>" + escapeXMLText(bookCreator) + "</dc:creator>\n")
	out.WriteString("<meta property=\"dcterms:modified\">" + meta.modifiedAt.UTC().Format("2006-01-02T15:04:05Z") + "</meta>\n")
	out.WriteString("</metadata>\n<manifest>\n")
	out.WriteString("<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n")
	out.WriteString("<item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>\n")
	out.WriteString("<item id=\"css\" href=\"styles.css\" media-type=\"text/css\"/>\n")

	for i := range meta.chapters {
		_, _ = fmt.Fprintf(&out, "<item id=\"chapter-%04d\" href=\"%s\" media-type=\"application/xhtml+xml\"/>\n", i+1, chapterHref(i))
	}

	for _, img := range meta.images {
		_, _ = fmt.Fprintf(&out, "<item id=\"img-%04d\" href=\"images/%s\" media-type=\"%s\"/>\n", img.number, img.fileName(), img.asset.format.mediaType)
	}

	out.WriteString("</manifest>\n<spine toc=\"ncx\">\n")

	for i := range meta.chapters {
		_, _ = fmt.Fprintf(&out, "<itemref idref=\"chapter-%04d\"/>\n", i+1)
	}

	out.WriteString("</spine>\n</package>\n")

	return []byte(out.String())
}

func chapterHref(index int) string {
	return fmt.Sprintf("%schapter-%04d.xhtml", chapterSourcePrefix, index+1)
}
