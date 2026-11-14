import {
  FeedItemRepository,
  FeedRepository,
  FolderRepository,
  SavedPageRepository,
  SettingRepository,
} from '@reader/business';
import { Context, Effect, Layer, Semaphore } from 'effect';
import type { Surreal } from 'surrealdb';
import { Database } from '../db';
import { makeFeedRepository } from './feed';
import { makeFeedItemRepository } from './feed-item';
import { makeFolderRepository } from './folder';
import { makeSavedPageRepository } from './saved-page';
import { makeSettingRepository } from './setting';

class ReaderStoreConcurrency extends Context.Service<
  ReaderStoreConcurrency,
  Semaphore.Semaphore
>()('reader/ReaderStoreConcurrency') {}

export const ReaderStoreConcurrencyLive = Layer.effect(
  ReaderStoreConcurrency,
  Semaphore.make(1)
);

const lockedRepositoryLayer = <Id, S>(
  tag: Context.Service<Id, S>,
  make: (db: Surreal, lock: Semaphore.Semaphore) => S
) =>
  Layer.effect(
    tag,
    Effect.gen(function* () {
      const db = yield* Database;
      const lock = yield* ReaderStoreConcurrency;

      return make(db, lock);
    })
  );

export const FeedItemRepositoryLive = lockedRepositoryLayer(
  FeedItemRepository,
  makeFeedItemRepository
);

export const SavedPageRepositoryLive = lockedRepositoryLayer(
  SavedPageRepository,
  makeSavedPageRepository
);

export const FeedRepositoryLive = lockedRepositoryLayer(
  FeedRepository,
  makeFeedRepository
);

export const FolderRepositoryLive = lockedRepositoryLayer(
  FolderRepository,
  makeFolderRepository
);

export const ReaderStoreLive = Layer.mergeAll(
  FeedItemRepositoryLive,
  SavedPageRepositoryLive,
  FeedRepositoryLive,
  FolderRepositoryLive
).pipe(Layer.provide(ReaderStoreConcurrencyLive));

export const SettingRepositoryLive = Layer.effect(
  SettingRepository,
  Effect.gen(function* () {
    const db = yield* Database;

    return makeSettingRepository(db);
  })
);
