package epub

import (
	"archive/zip"
	"bufio"
	"bytes"
	"compress/flate"
	"context"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"reader/internal/domain"
)

const (
	epubMimetype        = "application/epub+zip"
	bookCreator         = "Lantern"
	bookLanguage        = "zh"
	chapterSourcePrefix = "chapters/"
	oebpsPrefix         = "OEBPS/"
	imagesPrefix        = "OEBPS/images/"
	xmlDeclaration      = "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n"
	xhtmlOpenTag        = "<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"" + bookLanguage + "\" lang=\"" + bookLanguage + "\">\n"
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
	zipDeflateReaderVersion  = 20
	remoteResourcesAttr      = " properties=\"remote-resources\""
)

var (
	errArchiveTooLarge = errors.New("epub archive exceeds max bytes")
	zeroCopyBuf        [32 << 10]byte
)

type chapterMeta struct {
	title              string
	hasRemoteResources bool
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

	if err := writeStreamedZipEntry(writer, "OEBPS/content.opf", zip.Deflate, func(w io.Writer) error {
		return writeOPF(w, meta)
	}); err != nil {
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

	if err := writeStreamedZipEntry(writer, "OEBPS/content.opf", zip.Deflate, func(w io.Writer) error {
		return writeOPF(w, meta)
	}); err != nil {
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

func chapterNavOpfUncompressedBytes(chapterIndex int, chapter chapterMeta, newImages []imageManifestItem) int64 {
	hrefLen := int64(len(chapterHref(chapterIndex)))
	escapedTitleLen := int64(escapedXMLTextLen(chapter.title))
	plainDigits := int64(decimalDigits(chapterIndex + 1))
	paddedDigits := max(int64(4), plainDigits)

	navLine := int64(27) + hrefLen + escapedTitleLen
	ncxBlock := int64(102) + paddedDigits + plainDigits + escapedTitleLen + hrefLen
	opfChapter := int64(93) + 2*paddedDigits + hrefLen
	if chapter.hasRemoteResources {
		opfChapter += int64(len(remoteResourcesAttr))
	}

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
		name    string
		method  uint16
		body    []byte
		writeFn func(io.Writer) error
	}{
		{name: "mimetype", method: zip.Store, body: []byte(epubMimetype)},
		{name: "META-INF/container.xml", method: zip.Deflate, body: []byte(containerXML)},
		{name: "OEBPS/styles.css", method: zip.Deflate, body: []byte(stylesCSS)},
		{
			name:    "OEBPS/nav.xhtml",
			method:  zip.Deflate,
			writeFn: func(w io.Writer) error { return writeNav(w, meta.title, meta.chapters) },
		},
		{
			name:    "OEBPS/toc.ncx",
			method:  zip.Deflate,
			writeFn: func(w io.Writer) error { return writeNCX(w, meta) },
		},
	}

	for _, entry := range staticEntries {
		if err := ctx.Err(); err != nil {
			return err
		}

		if entry.writeFn != nil {
			if err := writeStreamedZipEntry(writer, entry.name, entry.method, entry.writeFn); err != nil {
				return err
			}

			continue
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
		ReaderVersion:      zipDeflateReaderVersion,
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

func writeStreamedZipEntry(writer *zip.Writer, name string, method uint16, writeFn func(io.Writer) error) error {
	entry, err := writer.CreateHeader(&zip.FileHeader{Name: name, Method: method})
	if err != nil {
		return wrapArchiveWriteError(err)
	}

	if err := writeFn(entry); err != nil {
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

type stickyXMLWriter struct {
	bw  *bufio.Writer
	err error
}

func newStickyXMLWriter(w io.Writer) *stickyXMLWriter {
	return &stickyXMLWriter{bw: bufio.NewWriter(w)}
}

func (w *stickyXMLWriter) ok() bool {
	return w.err == nil
}

func (w *stickyXMLWriter) writeString(s string) {
	if w.err != nil {
		return
	}

	if _, err := w.bw.WriteString(s); err != nil {
		w.err = err
	}
}

func (w *stickyXMLWriter) writeRune(r rune) {
	if w.err != nil {
		return
	}

	if _, err := w.bw.WriteRune(r); err != nil {
		w.err = err
	}
}

func (w *stickyXMLWriter) printf(format string, args ...any) {
	if w.err != nil {
		return
	}

	if _, err := fmt.Fprintf(w.bw, format, args...); err != nil {
		w.err = err
	}
}

func (w *stickyXMLWriter) flush() error {
	if w.err != nil {
		return w.err
	}

	return w.bw.Flush()
}

func writeNav(w io.Writer, title string, chapters []chapterMeta) error {
	sw := newStickyXMLWriter(w)
	sw.writeString(xmlDeclaration)
	sw.writeString("<!DOCTYPE html>\n")
	sw.writeString(xhtmlOpenTag)
	sw.writeString("<head>\n<meta charset=\"utf-8\"/>\n<title>")
	writeEscapedText(sw, title)
	sw.writeString("</title>\n</head>\n<body>\n<nav epub:type=\"toc\" id=\"toc\">\n<h1>目录</h1>\n<ol>\n")

	for i, ch := range chapters {
		if !sw.ok() {
			break
		}

		sw.printf("<li><a href=\"%s\">", chapterHref(i))
		writeEscapedText(sw, ch.title)
		sw.writeString("</a></li>\n")
	}

	sw.writeString("</ol>\n</nav>\n</body>\n</html>\n")

	return sw.flush()
}

func writeNCX(w io.Writer, meta archiveMeta) error {
	sw := newStickyXMLWriter(w)
	sw.writeString(xmlDeclaration)
	sw.writeString("<ncx xmlns=\"http://www.daisy.org/z3986/2005/ncx/\" version=\"2005-1\">\n")
	sw.writeString("<head>\n<meta name=\"dtb:uid\" content=\"")
	writeEscapedAttr(sw, meta.identity.identifier)
	sw.writeString("\"/>\n<meta name=\"dtb:depth\" content=\"1\"/>\n")
	sw.writeString("<meta name=\"dtb:totalPageCount\" content=\"0\"/>\n")
	sw.writeString("<meta name=\"dtb:maxPageNumber\" content=\"0\"/>\n</head>\n")
	sw.writeString("<docTitle><text>")
	writeEscapedText(sw, meta.title)
	sw.writeString("</text></docTitle>\n<navMap>\n")

	for i, ch := range meta.chapters {
		if !sw.ok() {
			break
		}

		sw.printf("<navPoint id=\"navPoint-%04d\" playOrder=\"%d\">\n<navLabel><text>", i+1, i+1)
		writeEscapedText(sw, ch.title)
		sw.printf("</text></navLabel>\n<content src=\"%s\"/>\n</navPoint>\n", chapterHref(i))
	}

	sw.writeString("</navMap>\n</ncx>\n")

	return sw.flush()
}

func writeOPF(w io.Writer, meta archiveMeta) error {
	sw := newStickyXMLWriter(w)
	sw.writeString(xmlDeclaration)
	sw.writeString("<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"book-id\">\n")
	sw.writeString("<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n")
	sw.writeString("<dc:identifier id=\"book-id\">")
	writeEscapedText(sw, meta.identity.identifier)
	sw.writeString("</dc:identifier>\n<dc:title>")
	writeEscapedText(sw, meta.title)
	sw.writeString("</dc:title>\n<dc:language>" + bookLanguage + "</dc:language>\n<dc:creator>")
	writeEscapedText(sw, bookCreator)
	sw.writeString("</dc:creator>\n<meta property=\"dcterms:modified\">" + meta.identity.modifiedAt.UTC().Format("2006-01-02T15:04:05Z") + "</meta>\n")
	sw.writeString("</metadata>\n<manifest>\n")
	sw.writeString("<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n")
	sw.writeString("<item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>\n")
	sw.writeString("<item id=\"css\" href=\"styles.css\" media-type=\"text/css\"/>\n")

	writeOPFManifest(sw, meta)
	writeOPFSpine(sw, meta.chapters)
	sw.writeString("</package>\n")

	return sw.flush()
}

func writeOPFManifest(sw *stickyXMLWriter, meta archiveMeta) {
	for i, ch := range meta.chapters {
		if !sw.ok() {
			return
		}

		props := ""
		if ch.hasRemoteResources {
			props = remoteResourcesAttr
		}

		sw.printf("<item id=\"chapter-%04d\" href=\"%s\" media-type=\"application/xhtml+xml\"%s/>\n", i+1, chapterHref(i), props)
	}

	for _, img := range meta.images {
		if !sw.ok() {
			return
		}

		sw.printf("<item id=\"img-%04d\" href=\"images/%s\" media-type=\"%s\"/>\n", img.number, img.fileName, img.mediaType)
	}

	sw.writeString("</manifest>\n")
}

func writeOPFSpine(sw *stickyXMLWriter, chapters []chapterMeta) {
	sw.writeString("<spine toc=\"ncx\">\n")

	for i := range chapters {
		if !sw.ok() {
			return
		}

		sw.printf("<itemref idref=\"chapter-%04d\"/>\n", i+1)
	}

	sw.writeString("</spine>\n")
}

func chapterHref(index int) string {
	return fmt.Sprintf("%schapter-%04d.xhtml", chapterSourcePrefix, index+1)
}
