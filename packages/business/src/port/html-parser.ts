import { Context, Data, type Effect, type Scope } from 'effect';

export class HtmlParserError extends Data.TaggedError('HtmlParserError')<{
  readonly message: string;
}> {}

export interface IHtmlParser {
  readonly parse: (
    html: string,
    url: URL
  ) => Effect.Effect<Document, HtmlParserError, Scope.Scope>;
}

export class HtmlParser extends Context.Service<HtmlParser, IHtmlParser>()(
  '@reader/business/HtmlParser'
) {}
