import { Effect, Option, Schema } from 'effect';
import type { FeedId } from '../entity/feed/feed';
import { FeedItem, FeedItemId } from '../entity/feed/feed-item';
import type { OwnerId } from '../entity/object-value/owner-id';
import { FeedItemRepository } from '../port/feed-item-repository';
import {
  FeedRepository,
  type FeedRepositoryError,
} from '../port/feed-repository';
import type { ReadFilter } from '../port/read-filter';
import { fetchAndExtract } from './extract-page';
import {
  FeedItemMissingUrl,
  FeedItemNotFound,
  FeedNotFound,
} from './feed-errors';
import type { ListCursor } from './list-cursor';
import { makePaging } from './pagination';

export const FeedItemList = Schema.Struct({
  items: Schema.Array(FeedItem),
  cursor: Schema.NullOr(Schema.String),
  boundary: Schema.NullOr(Schema.String),
});

export type FeedItemList = typeof FeedItemList.Type;

export const requireFeed = (
  owner: OwnerId,
  feedId: FeedId
): Effect.Effect<void, FeedNotFound | FeedRepositoryError, FeedRepository> =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    if (Option.isNone(yield* feeds.find(owner, feedId))) {
      return yield* new FeedNotFound({
        message: 'Feed not found',
        id: feedId,
      });
    }
  });

const resolveFeedIds = (owner: OwnerId, feedId: FeedId | undefined) =>
  Effect.gen(function* () {
    if (feedId !== undefined) {
      yield* requireFeed(owner, feedId);

      return [feedId];
    }

    const feeds = yield* FeedRepository;

    return (yield* feeds.list(owner)).map((feed) => feed.id);
  });

const feedItemPaging = (
  owner: OwnerId,
  feedId: FeedId | undefined,
  filter: ReadFilter
) =>
  Effect.gen(function* () {
    const feedIds = yield* resolveFeedIds(owner, feedId);
    const feedItems = yield* FeedItemRepository;

    return makePaging({
      owner,
      scope: { kind: 'feeds', feedId: Option.fromUndefinedOr(feedId) },
      filter,
      toId: FeedItemId.make,
      fetch: (query) => feedItems.list(feedIds, query),
    });
  });

export const listFeedItems = (
  owner: OwnerId,
  feedId: FeedId | undefined,
  filter: ReadFilter,
  cursor?: ListCursor,
  through?: ListCursor
) =>
  Effect.gen(function* () {
    const paging = yield* feedItemPaging(owner, feedId, filter);

    return yield* paging.list(cursor, through);
  });

export const refreshFeedItems = (
  owner: OwnerId,
  feedId: FeedId | undefined,
  filter: ReadFilter,
  through: ListCursor
) =>
  Effect.gen(function* () {
    const paging = yield* feedItemPaging(owner, feedId, filter);

    return yield* paging.refresh(through);
  });

export const extractFeedItem = (
  owner: OwnerId,
  feedId: FeedId,
  id: FeedItemId
) =>
  Effect.gen(function* () {
    yield* requireFeed(owner, feedId);
    const feedItems = yield* FeedItemRepository;
    const notFound = () =>
      new FeedItemNotFound({ message: 'Feed item not found', id });
    const found = yield* feedItems.find(feedId, id);
    if (Option.isNone(found)) {
      return yield* notFound();
    }

    const item = found.value;
    if (Option.isSome(item.extractedContent)) {
      return item;
    }

    if (Option.isNone(item.url)) {
      return yield* new FeedItemMissingUrl({
        message: 'Feed item has no source URL',
      });
    }

    const extracted = yield* fetchAndExtract(item.url.value);
    const extractedContent = Option.some(extracted.content);
    const updated = yield* feedItems.update(feedId, [id], {
      extractedContent,
    });
    if (updated.length === 0) {
      return yield* notFound();
    }

    return { ...item, extractedContent };
  });
