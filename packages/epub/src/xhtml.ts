import type { EbookChapter } from '@reader/business';
import { DateTime, Option } from 'effect';

/**
 * The XHTML namespace declared once on each content document (KD-BOOK-1).
 * Nested elements inherit it, so the serializer's per-element copy is noise.
 */
const XHTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/** Everything outside the XML 1.0 character range, lone surrogates included. */
const NOT_XML_CHARACTER =
  /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

/**
 * Drops the characters XML forbids, such as U+0001, which sanitized HTML may
 * still hold; without this a chapter would not parse as XML (KD-BOOK-5).
 */
export const xmlCharacters = (text: string): string =>
  text.replace(NOT_XML_CHARACTER, '');

/** Escapes text and attribute values so a title or URL is shown literally (KD-BOOK-3). */
export const escapeXml = (text: string): string =>
  xmlCharacters(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const publishedDate = (chapter: EbookChapter): string =>
  Option.match(chapter.publishedAt, {
    onNone: () => '',
    onSome: (date) => ` · ${DateTime.formatIsoDateUtc(date)}`,
  });

/** Source, publish date when there is one and address (KD-BOOK-3). */
const metaLine = (chapter: EbookChapter): string => {
  const address = escapeXml(chapter.url.href);

  return `<p class="meta">${escapeXml(chapter.source)}${publishedDate(
    chapter
  )} · <a href="${address}">${address}</a></p>`;
};

/**
 * Serializes the sanitized article HTML as well-formed XHTML (KD-BOOK-5).
 * jsdom's serializer puts the XHTML namespace on every serialized root
 * element; the chapter declares it once on `<html>`, so those copies are
 * stripped and the result is a single document that parses as XML.
 */
export const serializeBody = (document: Document): string => {
  const view = document.defaultView;

  if (view === null) {
    throw new Error('The article document has no window');
  }

  const serializer = new view.XMLSerializer();

  return Array.from(document.body.childNodes)
    .map((child) =>
      xmlCharacters(serializer.serializeToString(child)).replaceAll(
        ` xmlns="${XHTML_NAMESPACE}"`,
        ''
      )
    )
    .join('\n');
};

/** One chapter document: title heading, the meta line, then the text (KD-BOOK-3). */
export const chapterDocument = (
  chapter: EbookChapter,
  content: string
): string => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="${XHTML_NAMESPACE}" xml:lang="zh" lang="zh">
<head>
  <meta charset="utf-8" />
  <title>${escapeXml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
  <h1>${escapeXml(chapter.title)}</h1>
  ${metaLine(chapter)}
${content}
</body>
</html>`;
