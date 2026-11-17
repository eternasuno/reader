import { Context, Data, type Effect, type Scope } from 'effect';

export class HtmlParserError extends Data.TaggedError('HtmlParserError')<{
  readonly message: string;
}> {}

export interface IHtmlParser {
  /**
   * Parses HTML text against the base URL. The document lives in the caller's
   * resource scope, opened by `fetchAndExtract` or by the cleaning step of the
   * feed refresh; the scope covers the parse and the following extract or
   * sanitize step and is released when that step ends.
   */
  readonly parse: (
    html: string,
    url: URL
  ) => Effect.Effect<Document, HtmlParserError, Scope.Scope>;
}

export class HtmlParser extends Context.Service<HtmlParser, IHtmlParser>()(
  '@reader/business/HtmlParser'
) {}
