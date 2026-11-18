import { Effect, Layer, Option } from 'effect';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import type { Feed, FeedId } from '../../../src/entity/feed/feed';
import type { FeedItem } from '../../../src/entity/feed-item/feed-item';
import type { FeedRepositoryError } from '../../../src/error/feed';
import type { FeedItemRepositoryError } from '../../../src/error/feed-item';
import { FeedItemRepository } from '../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../src/port/feed-repository';
import type { FolderRepository } from '../../../src/port/folder-repository';
import {
  alice,
  type FeedItemOverrides,
  itemRow,
  makeUniqueFeed,
} from '../../support/fixtures';
import { MemoryFeedStoreLive } from '../../support/memory/feed-store';
import {
  type FetchDoubles,
  type FetchServices,
  fetchLayers,
} from '../common/harness';

/** The ports of the feed-item lists and of one extraction (FD-LIST, FD-EXTRACT). */
export type FeedItemServices =
  | FeedRepository
  | FeedItemRepository
  | FolderRepository
  | FetchServices;

/** One fresh feed store per provide, so every test starts from no row. */
export const feedItemLayer = (
  doubles: FetchDoubles = {},
  store: Layer.Layer<
    FeedRepository | FeedItemRepository | FolderRepository
  > = MemoryFeedStoreLive
): Layer.Layer<FeedItemServices> => Layer.mergeAll(store, fetchLayers(doubles));

export const runItems = <A, E>(
  effect: Effect.Effect<A, E, FeedItemServices>,
  doubles: FetchDoubles = {}
): Effect.Effect<A, E> => effect.pipe(Effect.provide(feedItemLayer(doubles)));

/** The items of one feed as they are stored now, newest first (FD-LIST-4). */
export const storedItems = (
  feedId: FeedId,
  owner: OwnerId = alice
): Effect.Effect<
  ReadonlyArray<FeedItem>,
  FeedItemRepositoryError,
  FeedItemRepository
> =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;

    return yield* items.listByFeed(owner, feedId, {
      limit: 1000,
      unread: false,
      cursor: Option.none(),
    });
  });

/**
 * One feed of the owner with `count` items in creation order (FD-ID-2), so the
 * last one has the largest id and is listed first.
 */
export const storeFeedWithItems = (
  count: number,
  overrides: FeedItemOverrides = {},
  owner: OwnerId = alice
): Effect.Effect<
  { readonly feed: Feed; readonly items: ReadonlyArray<FeedItem> },
  FeedRepositoryError | FeedItemRepositoryError,
  FeedRepository | FeedItemRepository
> =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const items = yield* FeedItemRepository;
    const feed = makeUniqueFeed({ ownerId: owner });
    const rows = Array.from({ length: count }, () =>
      itemRow(feed.id, { ownerId: owner, ...overrides })
    );

    yield* feeds.create(owner, [feed]);
    yield* items.create(owner, rows);

    return { feed, items: rows };
  });
