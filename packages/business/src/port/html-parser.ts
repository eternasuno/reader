import { Context, type Effect, Schema, type Scope } from 'effect';
import type { HtmlParserError } from '../error/common';

/**
 * A parsed document. Opaque to business: the content adapter (jsdom) defines
 * what it is, and no business module reads the DOM (CM-FETCH step 2, CM-HTML
 * step 2). Its lifetime is the caller's `Scope`.
 */
export const HtmlDocument = Schema.Unknown.pipe(Schema.brand('HtmlDocument'));

export type HtmlDocument = typeof HtmlDocument.Type;

/** Parses HTML text into a document (CM-FETCH step 2, CM-HTML step 2). */
export interface IHtmlParser {
  /**
   * Parses the text against `url`, which resolves relative links (CM-HTML-3).
   * The document lives in the caller's resource scope, opened by
   * `fetchAndExtract` or by the cleaning step of the refresh; the scope covers
   * the parse and the following extract or sanitize step and is released when
   * that step ends (CM-FETCH-2). Text that cannot be parsed is `HtmlParserError`
   * (CM-FETCH-4, CM-HTML-4).
   */
  readonly parse: (
    html: string,
    url: URL
  ) => Effect.Effect<HtmlDocument, HtmlParserError, Scope.Scope>;
}

export class HtmlParser extends Context.Service<HtmlParser, IHtmlParser>()(
  '@reader/business/HtmlParser'
) {}
