package epub

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"context"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"reader/internal/domain"
)

const (
	epubMimetype        = "application/epub+zip"
	bookCreator         = "Lantern"
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
	deflateStoredBlockStride = 65535
	deflateBlockHeaderBytes  = 5
	deflateFixedStreamSlack  = 256
	zipLocalFileHeaderLen    = 30
	zipCentralDirHeaderLen   = 46
	zip64EOCDOverheadLen     = 76
	zipMaxNonZip64Entries    = 65535
	zipStaticEntryCount      = 6
	maxMeasurementMargin     = 8 << 10
	minMeasurementMargin     = 1 << 10
)

var (
	errArchiveTooLarge = errors.New("epub archive exceeds max bytes")
	zeroCopyBuf        [32 << 10]byte
)

type chapterMeta struct {
	title string
}

type imageManifestItem struct {
	number    int
	fileName  string
	mediaType string
}

type spooledEntry struct {
	name             string
	method           uint16
	crc32            uint32
	compressedSize   uint64
	uncompressedSize uint64
	offset           int64
}

type compressedEntry struct {
	spooled spooledEntry
	data    []byte
}

type bookIdentity struct {
	identifier string
	modifiedAt time.Time
}

func newBookIdentity() bookIdentity {
	return bookIdentity{
		identifier: "urn:uuid:" + uuid.NewString(),
		modifiedAt: time.Now().UTC(),
	}
}

type archiveMeta struct {
	title    string
	identity bookIdentity
	chapters []chapterMeta
	images   []imageManifestItem
}

type limitCountWriter struct {
	limit int64
	count int64
	w     io.Writer
}

func (l *limitCountWriter) Write(p []byte) (int, error) {
	next := l.count + int64(len(p))
	if next > l.limit {
		l.count = next
		return 0, errArchiveTooLarge
	}

	if l.w != nil {
		n, err := l.w.Write(p)
		l.count += int64(n)
		return n, err
	}

	l.count = next
	return len(p), nil
}

func compressDeflateBounded(name string, raw []byte, maxBytes int64) (compressedEntry, error) {
	return compressDeflateBoundedWith(nil, name, raw, maxBytes)
}

func compressDeflateBoundedWith(fw *flate.Writer, name string, raw []byte, maxBytes int64) (compressedEntry, error) {
	var buf bytes.Buffer
	lw := &limitCountWriter{limit: maxBytes, w: &buf}

	if fw == nil {
		var err error
		fw, err = flate.NewWriter(lw, flate.DefaultCompression)
		if err != nil {
			return compressedEntry{}, err
		}
	} else {
		fw.Reset(lw)
	}

	if _, err := fw.Write(raw); err != nil {
		_ = fw.Close()
		return compressedEntry{}, err
	}

	if err := fw.Close(); err != nil {
		return compressedEntry{}, err
	}

	compressed := buf.Bytes()

	return compressedEntry{
		spooled: spooledEntry{
			name:             name,
			method:           zip.Deflate,
			crc32:            crc32.ChecksumIEEE(raw),
			compressedSize:   uint64(len(compressed)),
			uncompressedSize: uint64(len(raw)),
		},
		data: compressed,
	}, nil
}

func measureArchiveSize(
	ctx context.Context,
	meta archiveMeta,
	existing []spooledEntry,
	added []spooledEntry,
	maxBytes int64,
) (int64, error) {
	lw := &limitCountWriter{limit: maxBytes}
	writer := zip.NewWriter(lw)

	if err := writeStaticAndNavEntries(ctx, writer, meta); err != nil {
		return lw.count, err
	}

	if err := writeZeroEntries(ctx, writer, existing); err != nil {
		return lw.count, err
	}

	if err := writeZeroEntries(ctx, writer, added); err != nil {
		return lw.count, err
	}

	if err := writeZipEntry(writer, "OEBPS/content.opf", zip.Deflate, renderOPF(meta)); err != nil {
		return lw.count, err
	}

	if err := writer.Close(); err != nil {
		return lw.count, wrapArchiveWriteError(err)
	}

	return lw.count, nil
}

func writeFinalArchive(
	ctx context.Context,
	meta archiveMeta,
	spoolPath string,
	entries []spooledEntry,
	maxBytes int64,
) ([]byte, error) {
	var buf bytes.Buffer
	lw := &limitCountWriter{limit: maxBytes, w: &buf}
	writer := zip.NewWriter(lw)

	if err := writeStaticAndNavEntries(ctx, writer, meta); err != nil {
		return nil, err
	}

	if err := copySpooledEntries(ctx, writer, spoolPath, entries); err != nil {
		return nil, err
	}

	if err := writeZipEntry(writer, "OEBPS/content.opf", zip.Deflate, renderOPF(meta)); err != nil {
		return nil, err
	}

	if err := writer.Close(); err != nil {
		return nil, wrapArchiveWriteError(err)
	}

	return buf.Bytes(), nil
}

func spooledEntryZipBytes(entry spooledEntry) int64 {
	return zipLocalFileHeaderLen + zipCentralDirHeaderLen + 2*int64(len(entry.name)) + int64(entry.compressedSize)
}

func chapterNavOpfUncompressedBytes(chapterIndex int, title string, newImages []imageManifestItem) int64 {
	hrefLen := int64(len(chapterHref(chapterIndex)))
	escapedTitleLen := int64(escapedXMLTextLen(title))
	plainDigits := int64(decimalDigits(chapterIndex + 1))
	paddedDigits := max(int64(4), plainDigits)

	navLine := int64(27) + hrefLen + escapedTitleLen
	ncxBlock := int64(102) + paddedDigits + plainDigits + escapedTitleLen + hrefLen
	opfChapter := int64(93) + 2*paddedDigits + hrefLen

	var opfImages int64
	for _, img := range newImages {
		imgDigits := max(int64(4), int64(decimalDigits(img.number)))
		opfImages += int64(47) + imgDigits + int64(len(img.fileName)) + int64(len(img.mediaType))
	}

	return navLine + ncxBlock + opfChapter + opfImages
}

func estimateArchiveUpperBound(
	anchoredSize int64,
	spooledSinceAnchor int64,
	navMetaSinceAnchor int64,
	totalEntries int,
	anchoredZip64 bool,
) int64 {
	blocks := navMetaSinceAnchor/deflateStoredBlockStride + 1
	navUpperBound := navMetaSinceAnchor + blocks*deflateBlockHeaderBytes + deflateFixedStreamSlack

	var zip64Delta int64
	if totalEntries >= zipMaxNonZip64Entries && !anchoredZip64 {
		zip64Delta = zip64EOCDOverheadLen
	}

	return anchoredSize + spooledSinceAnchor + navUpperBound + zip64Delta
}

func measurementMargin(maxBytes int64) int64 {
	return min(maxMeasurementMargin, max(minMeasurementMargin, maxBytes/32))
}

func decimalDigits(n int) int {
	digits := 1
	for n >= 10 {
		n /= 10
		digits++
	}

	return digits
}

func escapedXMLTextLen(text string) int {
	n := 0
	for _, r := range text {
		switch r {
		case '&':
			n += 5
		case '<', '>':
			n += 4
		default:
			if isXMLChar(r) {
				n += utf8.RuneLen(r)
			}
		}
	}

	return n
}

func writeStaticAndNavEntries(ctx context.Context, writer *zip.Writer, meta archiveMeta) error {
	staticEntries := []struct {
		name   string
		method uint16
		body   []byte
	}{
		{name: "mimetype", method: zip.Store, body: []byte(epubMimetype)},
		{name: "META-INF/container.xml", method: zip.Deflate, body: []byte(containerXML)},
		{name: "OEBPS/styles.css", method: zip.Deflate, body: []byte(stylesCSS)},
		{name: "OEBPS/nav.xhtml", method: zip.Deflate, body: renderNav(meta.title, meta.chapters)},
		{name: "OEBPS/toc.ncx", method: zip.Deflate, body: renderNCX(meta)},
	}

	for _, entry := range staticEntries {
		if err := ctx.Err(); err != nil {
			return err
		}

		if err := writeZipEntry(writer, entry.name, entry.method, entry.body); err != nil {
			return err
		}
	}

	return nil
}

func writeZeroEntries(ctx context.Context, writer *zip.Writer, entries []spooledEntry) error {
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}

		fw, err := createRawEntry(writer, entry)
		if err != nil {
			return err
		}

		if err := writeZeros(fw, entry.compressedSize); err != nil {
			return err
		}
	}

	return nil
}

func copySpooledEntries(ctx context.Context, writer *zip.Writer, spoolPath string, entries []spooledEntry) error {
	if len(entries) == 0 {
		return nil
	}

	root, err := os.OpenRoot(filepath.Dir(spoolPath))
	if err != nil {
		return fmt.Errorf("open epub spool dir: %s", domain.SanitizeErrorText(err.Error()))
	}
	defer func() { _ = root.Close() }()

	spoolFile, err := root.Open(filepath.Base(spoolPath))
	if err != nil {
		return fmt.Errorf("open epub spool: %s", domain.SanitizeErrorText(err.Error()))
	}
	defer func() { _ = spoolFile.Close() }()

	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return err
		}

		fw, err := createRawEntry(writer, entry)
		if err != nil {
			return err
		}

		reader := io.NewSectionReader(spoolFile, entry.offset, int64(entry.compressedSize))
		if _, err := io.CopyN(fw, reader, int64(entry.compressedSize)); err != nil {
			return wrapArchiveWriteError(err)
		}
	}

	return nil
}

func createRawEntry(writer *zip.Writer, entry spooledEntry) (io.Writer, error) {
	fh := &zip.FileHeader{
		Name:               entry.name,
		Method:             entry.method,
		CRC32:              entry.crc32,
		CompressedSize64:   entry.compressedSize,
		UncompressedSize64: entry.uncompressedSize,
	}

	fw, err := writer.CreateRaw(fh)
	if err != nil {
		return nil, wrapArchiveWriteError(err)
	}

	return fw, nil
}

func writeZeros(w io.Writer, remaining uint64) error {
	for remaining > 0 {
		chunk := min(remaining, uint64(len(zeroCopyBuf)))
		if _, err := w.Write(zeroCopyBuf[:chunk]); err != nil {
			return wrapArchiveWriteError(err)
		}

		remaining -= chunk
	}

	return nil
}

func writeZipEntry(writer *zip.Writer, name string, method uint16, body []byte) error {
	entry, err := writer.CreateHeader(&zip.FileHeader{Name: name, Method: method})
	if err != nil {
		return wrapArchiveWriteError(err)
	}

	if _, err := entry.Write(body); err != nil {
		return wrapArchiveWriteError(err)
	}

	return nil
}

func wrapArchiveWriteError(err error) error {
	if errors.Is(err, errArchiveTooLarge) {
		return errArchiveTooLarge
	}

	return fmt.Errorf("write epub archive: %s", domain.SanitizeErrorText(err.Error()))
}

func renderNav(title string, chapters []chapterMeta) []byte {
	var out strings.Builder
	out.WriteString(xmlDeclaration)
	out.WriteString("<!DOCTYPE html>\n")
	out.WriteString(xhtmlOpenTag)
	out.WriteString("<head>\n<meta charset=\"utf-8\"/>\n<title>")
	writeEscapedText(&out, title)
	out.WriteString("</title>\n</head>\n<body>\n<nav epub:type=\"toc\" id=\"toc\">\n<h1>目录</h1>\n<ol>\n")

	for i, ch := range chapters {
		out.WriteString("<li><a href=\"" + chapterHref(i) + "\">" + escapeXMLText(ch.title) + "</a></li>\n")
	}

	out.WriteString("</ol>\n</nav>\n</body>\n</html>\n")

	return []byte(out.String())
}

func renderNCX(meta archiveMeta) []byte {
	var out strings.Builder
	out.WriteString(xmlDeclaration)
	out.WriteString("<ncx xmlns=\"http://www.daisy.org/z3986/2005/ncx/\" version=\"2005-1\">\n")
	out.WriteString("<head>\n<meta name=\"dtb:uid\" content=\"" + escapeXMLAttr(meta.identity.identifier) + "\"/>\n")
	out.WriteString("<meta name=\"dtb:depth\" content=\"1\"/>\n")
	out.WriteString("<meta name=\"dtb:totalPageCount\" content=\"0\"/>\n")
	out.WriteString("<meta name=\"dtb:maxPageNumber\" content=\"0\"/>\n</head>\n")
	out.WriteString("<docTitle><text>" + escapeXMLText(meta.title) + "</text></docTitle>\n<navMap>\n")

	for i, ch := range meta.chapters {
		_, _ = fmt.Fprintf(&out, "<navPoint id=\"navPoint-%04d\" playOrder=\"%d\">\n", i+1, i+1)
		out.WriteString("<navLabel><text>" + escapeXMLText(ch.title) + "</text></navLabel>\n")
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
	out.WriteString("<dc:identifier id=\"book-id\">" + escapeXMLText(meta.identity.identifier) + "</dc:identifier>\n")
	out.WriteString("<dc:title>" + escapeXMLText(meta.title) + "</dc:title>\n")
	out.WriteString("<dc:language>zh-CN</dc:language>\n")
	out.WriteString("<dc:creator>" + escapeXMLText(bookCreator) + "</dc:creator>\n")
	out.WriteString("<meta property=\"dcterms:modified\">" + meta.identity.modifiedAt.UTC().Format("2006-01-02T15:04:05Z") + "</meta>\n")
	out.WriteString("</metadata>\n<manifest>\n")
	out.WriteString("<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n")
	out.WriteString("<item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>\n")
	out.WriteString("<item id=\"css\" href=\"styles.css\" media-type=\"text/css\"/>\n")

	for i := range meta.chapters {
		_, _ = fmt.Fprintf(&out, "<item id=\"chapter-%04d\" href=\"%s\" media-type=\"application/xhtml+xml\"/>\n", i+1, chapterHref(i))
	}

	for _, img := range meta.images {
		_, _ = fmt.Fprintf(&out, "<item id=\"img-%04d\" href=\"images/%s\" media-type=\"%s\"/>\n", img.number, img.fileName, img.mediaType)
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
