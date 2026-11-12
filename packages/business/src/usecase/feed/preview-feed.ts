import { Effect, type Option } from 'effect';
import type { HttpClient } from 'effect/http';
import type { ArticleTitle } from '../../entity/common/article';
import type { NormalizedUrl } from '../../entity/common/normalized-url';
import type { FeedTitle } from '../../entity/feed/feed';
import type { FeedParser, FeedParserError } from '../../port/feed-parser';
import type { FetchFeedError } from './errors';
import { fetchParsedFeed } from './fetch-parsed-feed';

export type FeedPreview = {
  readonly title: FeedTitle;
  readonly description: Option.Option<string>;
  readonly entryTitles: ReadonlyArray<ArticleTitle>;
};

export const previewFeed = (
  url: NormalizedUrl
): Effect.Effect<
  FeedPreview,
  FetchFeedError | FeedParserError,
  HttpClient.HttpClient | FeedParser
> =>
  Effect.map(fetchParsedFeed(url), (parsed) => ({
    title: parsed.title,
    description: parsed.description,
    entryTitles: parsed.entries.map((entry) => entry.title),
  }));
