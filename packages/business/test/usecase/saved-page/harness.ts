import { Effect, Layer, Option } from 'effect';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import type { FeedItem } from '../../../src/entity/feed-item/feed-item';
import type { SavedPage } from '../../../src/entity/saved-page/saved-page';
import type { FeedRepositoryError } from '../../../src/error/feed';
import type { FeedItemRepositoryError } from '../../../src/error/feed-item';
import { FeedItemNotFound } from '../../../src/error/feed-item';
import type { SavedPageRepositoryError } from '../../../src/error/saved-page';
import { SavedPageAlreadyExists } from '../../../src/error/saved-page';
import { FeedItemRepository } from '../../../src/port/feed-item-repository';
import type { FeedRepository } from '../../../src/port/feed-repository';
import type { FolderRepository } from '../../../src/port/folder-repository';
import { SavedPageRepository } from '../../../src/port/saved-page-repository';
import {
  alice,
  type FeedItemOverrides,
  makeUniqueFeedItem,
  storedFeed,
} from '../../support/fixtures';
import { MemoryFeedStoreLive } from '../../support/memory/feed-store';
import { MemorySavedPageRepositoryLive } from '../../support/memory/saved-page';
import {
  type FetchDoubles,
  type FetchServices,
  fetchLayers,
} from '../common/harness';

/** The ports of an added link and of a saved feed item (SP-ADD, SP-SAVE). */
export type SavedPageServices =
  | SavedPageRepository
  | FeedItemRepository
  | FeedRepository
  | FolderRepository
  | FetchServices;

/** One fresh store per provide, so every test starts from no row. */
export const savedPageLayer = (
  doubles: FetchDoubles = {},
  feedStore: Layer.Layer<
    FeedRepository | FeedItemRepository | FolderRepository
  > = MemoryFeedStoreLive
): Layer.Layer<SavedPageServices> =>
  Layer.mergeAll(
    MemorySavedPageRepositoryLive,
    feedStore,
    fetchLayers(doubles)
  );

export const run = <A, E>(
  effect: Effect.Effect<A, E, SavedPageServices>,
  doubles: FetchDoubles = {}
): Effect.Effect<A, E> => effect.pipe(Effect.provide(savedPageLayer(doubles)));

/** Every page of the owner, newest first (SP-LIST-1). */
export const storedPages = (
  owner: OwnerId = alice
): Effect.Effect<
  ReadonlyArray<SavedPage>,
  SavedPageRepositoryError,
  SavedPageRepository
> =>
  Effect.gen(function* () {
    const pages = yield* SavedPageRepository;

    return yield* pages.list(owner, {
      limit: 1000,
      unread: false,
      cursor: Option.none(),
    });
  });

/** One feed item of the owner's feed, stored and returned (FD-ID-2). */
export const storeFeedItem = (
  overrides: FeedItemOverrides = {}
): Effect.Effect<
  FeedItem,
  FeedRepositoryError | FeedItemRepositoryError,
  FeedRepository | FeedItemRepository
> =>
  Effect.gen(function* () {
    const feed = yield* storedFeed(alice);
    const items = yield* FeedItemRepository;
    const item = makeUniqueFeedItem({ feedId: feed.id, ...overrides });

    yield* items.create(alice, [item]);

    return item;
  });

/** The item as it is stored now (SP-SAVE-4). */
export const storedItem = (
  item: FeedItem
): Effect.Effect<
  FeedItem | undefined,
  FeedItemRepositoryError,
  FeedItemRepository
> =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const found = yield* items.find(alice, item.id);

    return Option.getOrUndefined(found);
  });

export const asAlreadyExists = (error: {
  readonly _tag: string;
}): SavedPageAlreadyExists => {
  if (!(error instanceof SavedPageAlreadyExists)) {
    throw new Error(`expected SavedPageAlreadyExists, got ${error._tag}`);
  }

  return error;
};

export const asItemNotFound = (error: {
  readonly _tag: string;
}): FeedItemNotFound => {
  if (!(error instanceof FeedItemNotFound)) {
    throw new Error(`expected FeedItemNotFound, got ${error._tag}`);
  }

  return error;
};
