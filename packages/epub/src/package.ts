import type { Ebook } from '@reader/business';
import { DateTime } from 'effect';
import type { EmbeddedImage } from './images';
import { escapeXml } from './xhtml';

/** The zip's first entry, stored uncompressed (KD-BOOK-1). */
export const MIMETYPE = 'application/epub+zip';

/** Points the reader at the package document (KD-BOOK-1). */
export const containerXml = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`;

/** EPUB 3 wants the modification time in seconds and UTC, `YYYY-MM-DDTHH:MM:SSZ`. */
const modifiedAt = (createdAt: DateTime.Utc): string =>
  `${DateTime.formatIso(createdAt).slice(0, 19)}Z`;

const chapterItems = (count: number): string =>
  Array.from({ length: count }, (_, index) => {
    const id = `chapter-${index + 1}`;

    return `    <item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml" />`;
  }).join('\n');

const chapterRefs = (count: number): string =>
  Array.from(
    { length: count },
    (_, index) => `    <itemref idref="chapter-${index + 1}" />`
  ).join('\n');

const imageItems = (images: ReadonlyArray<EmbeddedImage>): string =>
  images
    .map(
      (image, index) =>
        `    <item id="img-${index + 1}" href="${image.path}" media-type="${image.mediaType}" />`
    )
    .join('\n');

/**
 * The package document: title, language, a generated urn:uuid identifier and
 * the modification time, plus the manifest and the spine in reading order
 * (KD-BOOK-1, KD-BOOK-2).
 */
export const contentOpf = (
  book: Ebook,
  images: ReadonlyArray<EmbeddedImage>
): string => `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="zh">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${crypto.randomUUID()}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:language>zh</dc:language>
    <meta property="dcterms:modified">${modifiedAt(book.createdAt)}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="style" href="style.css" media-type="text/css" />
${chapterItems(book.chapters.length)}
${imageItems(images)}
  </manifest>
  <spine>
${chapterRefs(book.chapters.length)}
  </spine>
</package>`;

/**
 * The table of contents: every article in the book, in reading order, linking
 * to its chapter (KD-BOOK-1, KD-BOOK-2).
 */
export const navXhtml = (book: Ebook): string => {
  const entries = book.chapters
    .map(
      (chapter, index) =>
        `      <li><a href="chapter-${index + 1}.xhtml">${escapeXml(
          chapter.title
        )}</a></li>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh" lang="zh">
<head>
  <meta charset="utf-8" />
  <title>目录</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>目录</h1>
    <ol>
${entries}
    </ol>
  </nav>
</body>
</html>`;
};

/** Small, readable typography for a Kindle screen; images shrink to the page. */
export const styleCss = `body {
  margin: 1em;
  font-family: serif;
  line-height: 1.6;
}

h1 {
  font-size: 1.4em;
  line-height: 1.3;
}

.meta {
  color: #555;
  font-size: 0.85em;
  word-break: break-all;
}

.meta a {
  color: #555;
}

img {
  max-width: 100%;
  height: auto;
}
`;
