import { Effect, Option } from 'effect';
import type { HttpClient } from 'effect/http';
import type { OwnerId } from '../../../entity/common/owner-id';
import type { FeedId } from '../../../entity/feed/feed';
import type {
  FeedParserError,
  FeedRepositoryError,
  FetchFeedError,
} from '../../../error/feed';
import type { FeedItemRepositoryError } from '../../../error/feed-item';
import type { SettingRepositoryError } from '../../../error/setting';
import type { DocumentSanitizer } from '../../../port/document-sanitizer';
import type { FeedItemRepository } from '../../../port/feed-item-repository';
import type { FeedParser } from '../../../port/feed-parser';
import { FeedRepository } from '../../../port/feed-repository';
import type { HtmlParser } from '../../../port/html-parser';
import type { SettingRepository } from '../../../port/setting-repository';
import { fetchParsedFeed } from '../fetch-parsed-feed';
import { syncFeed } from './sync';

/**
 * Refreshes one feed: find it, fetch and parse its source, then sync its items
 * (FD-REFRESH). Only the scheduler's refresh queue calls it (FD-SCHED-7), one
 * run per feed at a time (FD-SCHED-2). A feed that is gone before or during the
 * run is not an error (FD-REFRESH-1, FD-SYNC-5).
 */
export const refreshFeed = Effect.fn('refreshFeed')(function* (
  owner: OwnerId,
  feedId: FeedId
): Effect.fn.Return<
  void,
  | FetchFeedError
  | FeedParserError
  | FeedRepositoryError
  | FeedItemRepositoryError
  | SettingRepositoryError,
  | FeedRepository
  | FeedItemRepository
  | SettingRepository
  | HttpClient.HttpClient
  | FeedParser
  | HtmlParser
  | DocumentSanitizer
> {
  const feeds = yield* FeedRepository;
  const found = yield* feeds.find(owner, feedId);

  if (Option.isNone(found)) {
    return;
  }

  const parsed = yield* fetchParsedFeed(found.value.url);

  yield* syncFeed(owner, found.value, parsed);
});
