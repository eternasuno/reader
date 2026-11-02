import { Context, Data, type Effect, type Scope } from 'effect';

export class HtmlParseError extends Data.TaggedError('HtmlParseError')<{
  readonly error: string;
}> {}

export interface IHtmlParser {
  readonly parse: (
    html: string,
    url?: URL
  ) => Effect.Effect<Document, HtmlParseError, Scope.Scope>;
}

export class HtmlParser extends Context.Service<HtmlParser, IHtmlParser>()(
  'HtmlParser'
) {}
