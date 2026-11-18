import {
  ArticleContent,
  DocumentSanitizer,
  DocumentSanitizerError,
  type HtmlDocument,
  OptionFromOptionalNonEmpty,
} from '@reader/business';
import { Effect, Layer, type Option, Schema } from 'effect';
import { documentOf } from './html-parser';
import { sanitizeHtml } from './sanitize';

const decodeContent = Schema.decodeSync(
  OptionFromOptionalNonEmpty(ArticleContent)
);

const bodyOf = (document: Document): string =>
  document.body === null ? '' : document.body.innerHTML;

/** Blank after cleaning is none (CM-HTML-2). */
const sanitizeDocument = (document: Document): Option.Option<ArticleContent> =>
  decodeContent(sanitizeHtml(document, bodyOf(document)));

export const sanitize = Effect.fn('DocumentSanitizer.sanitize')(function* (
  document: HtmlDocument
) {
  return yield* Effect.try({
    try: () => sanitizeDocument(documentOf(document)),
    catch: () =>
      new DocumentSanitizerError({
        message: 'Unable to sanitize the document',
      }),
  });
});

export const DocumentSanitizerLive = Layer.succeed(DocumentSanitizer, {
  sanitize,
});
