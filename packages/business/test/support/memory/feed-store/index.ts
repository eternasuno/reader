import { Effect, Layer, Ref } from 'effect';
import {
  FeedItemRepository,
  type IFeedItemRepository,
} from '../../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../../src/port/feed-repository';
import { FolderRepository } from '../../../../src/port/folder-repository';
import { makeMemoryFeedRepository } from './feed';
import { makeMemoryFeedItemRepository } from './feed-item';
import { makeMemoryFolderRepository } from './folder';
import { emptyFeedState } from './state';

/**
 * Builds a fresh, empty store per call, so a caller that wants one state per
 * test calls the factory per test rather than reusing a memoized layer.
 */
export const memoryFeedStoreLayer = (
  decorateItems: (items: IFeedItemRepository) => IFeedItemRepository = (
    items
  ) => items
): Layer.Layer<FeedRepository | FeedItemRepository | FolderRepository> =>
  Layer.unwrap(
    Effect.map(Ref.make(emptyFeedState), (state) =>
      Layer.mergeAll(
        Layer.succeed(FeedRepository, makeMemoryFeedRepository(state)),
        Layer.succeed(FolderRepository, makeMemoryFolderRepository(state)),
        Layer.succeed(
          FeedItemRepository,
          decorateItems(makeMemoryFeedItemRepository(state))
        )
      )
    )
  );

export const MemoryFeedStoreLive: Layer.Layer<
  FeedRepository | FeedItemRepository | FolderRepository
> = memoryFeedStoreLayer();
