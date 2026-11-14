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
import type { MemoryFeedState } from './state';

export const memoryFeedStoreLayer = (
  decorateItems: (items: IFeedItemRepository) => IFeedItemRepository = (
    items
  ) => items
): Layer.Layer<FeedRepository | FeedItemRepository | FolderRepository> =>
  Layer.unwrap(
    Effect.map(
      Ref.make<MemoryFeedState>({ feeds: [], items: [], folders: [] }),
      (state) =>
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
