import { Effect, type Option } from 'effect';
import type { HttpClient } from 'effect/http';
import type { ArticleTitle } from '../../entity/common/article';
import type { NormalizedUrl } from '../../entity/common/normalized-url';
import type { FeedTitle } from '../../entity/feed/feed';
import type { FeedParserError, FetchFeedError } from '../../error/feed';
import type { FeedParser } from '../../port/feed-parser';
import { fetchParsedFeed } from './fetch-parsed-feed';

/** What the subscribe dialog shows before a subscription exists (FD-PREVIEW). */
export type FeedPreview = {
  readonly title: FeedTitle;
  readonly description: Option.Option<string>;
  /** Every entry title in source order; the client shows the first three. */
  readonly entryTitles: ReadonlyArray<ArticleTitle>;
};

/**
 * Previews a subscription: fetch and parse the source, then return its title,
 * its description if any and the entry titles (FD-PREVIEW). Nothing is stored
 * (FD-PREVIEW-1) and the title is what the client sends back when subscribing
 * (FD-PREVIEW-3).
 */
export const previewFeed = Effect.fn('previewFeed')(function* (
  url: NormalizedUrl
): Effect.fn.Return<
  FeedPreview,
  FetchFeedError | FeedParserError,
  HttpClient.HttpClient | FeedParser
> {
  const parsed = yield* fetchParsedFeed(url);

  return {
    title: parsed.title,
    description: parsed.description,
    entryTitles: parsed.entries.map((entry) => entry.title),
  };
});
