import { Context, type Effect } from 'effect';
import type { ParsedFeed } from '../entity/feed/feed';
import type { FeedParserError } from '../error/feed';

/** Reads RSS, Atom, RDF and JSON Feed into one `ParsedFeed`. */
export interface IFeedParser {
  /**
   * Parses one source document. `baseUrl` is the final URL of the response, the
   * URL of the last hop, and entry URLs are resolved against it while the feed
   * keeps the submitted URL (FD-FETCH-4, FD-PARSE-2). The contract is FD-PARSE:
   * one leading byte-order mark is removed and nothing else is trimmed
   * (FD-PARSE-1), every entry without a usable URL is dropped silently
   * (FD-PARSE-2), Atom and JSON Feed plain text is HTML-escaped once
   * (FD-PARSE-4, FD-PARSE-5), and the text is not sanitized here (CM-HTML does
   * that at import). A document that is not one of the four formats fails
   * totally with `FeedParserError` (FD-PARSE-1, FD-FETCH-2).
   */
  readonly parse: (
    text: string,
    baseUrl: URL
  ) => Effect.Effect<ParsedFeed, FeedParserError>;
}

export class FeedParser extends Context.Service<FeedParser, IFeedParser>()(
  '@reader/business/FeedParser'
) {}
