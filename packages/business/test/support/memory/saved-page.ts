import { Effect, Layer, Option, Ref } from 'effect';
import type { NormalizedUrl } from '../../../src/entity/common/normalized-url';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import type {
  SavedPage,
  SavedPageId,
} from '../../../src/entity/saved-page/saved-page';
import {
  type ISavedPageRepository,
  type SavedPageQuery,
  SavedPageRepository,
} from '../../../src/port/saved-page-repository';
import { byIdDescending } from './text';

type MemorySavedPageState = {
  readonly pages: ReadonlyArray<SavedPage>;
};

type SavedPageStateRef = Ref.Ref<MemorySavedPageState>;

const isPageTaken = (
  pages: ReadonlyArray<SavedPage>,
  owner: OwnerId,
  row: SavedPage
): boolean =>
  row.ownerId !== owner ||
  pages.some(
    (page) =>
      page.id === row.id ||
      (page.ownerId === row.ownerId && page.url.href === row.url.href)
  );

const insertPages = (
  pages: ReadonlyArray<SavedPage>,
  owner: OwnerId,
  rows: ReadonlyArray<SavedPage>
): {
  readonly pages: ReadonlyArray<SavedPage>;
  readonly created: ReadonlyArray<SavedPageId>;
} => {
  const stored: Array<SavedPage> = [...pages];
  const created: Array<SavedPageId> = [];

  for (const row of rows) {
    if (!isPageTaken(stored, owner, row)) {
      stored.push(row);
      created.push(row.id);
    }
  }

  return { pages: stored, created };
};

const findPage =
  (state: SavedPageStateRef) =>
  (owner: OwnerId, id: SavedPageId): Effect.Effect<Option.Option<SavedPage>> =>
    Effect.map(Ref.get(state), (store) =>
      Option.fromUndefinedOr(
        store.pages.find((page) => page.ownerId === owner && page.id === id)
      )
    );

const findPageByUrl =
  (state: SavedPageStateRef) =>
  (
    owner: OwnerId,
    url: NormalizedUrl
  ): Effect.Effect<Option.Option<SavedPage>> =>
    Effect.map(Ref.get(state), (store) =>
      Option.fromUndefinedOr(
        store.pages.find(
          (page) => page.ownerId === owner && page.url.href === url.href
        )
      )
    );

const listPages =
  (state: SavedPageStateRef) =>
  (
    owner: OwnerId,
    query: SavedPageQuery
  ): Effect.Effect<ReadonlyArray<SavedPage>> =>
    Effect.map(Ref.get(state), (store) =>
      store.pages
        .filter((page) => page.ownerId === owner)
        .filter((page) => !query.unread || !page.read)
        .filter(
          (page) => !Option.exists(query.cursor, (cursor) => page.id >= cursor)
        )
        .sort(byIdDescending)
        .slice(0, query.limit)
    );

const createPages =
  (state: SavedPageStateRef) =>
  (
    owner: OwnerId,
    pages: ReadonlyArray<SavedPage>
  ): Effect.Effect<ReadonlyArray<SavedPageId>> =>
    Ref.modify(state, (store) => {
      const inserted = insertPages(store.pages, owner, pages);

      return [inserted.created, { pages: inserted.pages }];
    });

const markPages =
  (state: SavedPageStateRef) =>
  (
    owner: OwnerId,
    ids: ReadonlyArray<SavedPageId>,
    read: boolean
  ): Effect.Effect<void> =>
    Ref.update(state, (store) => {
      const wanted = new Set<string>(ids);

      return {
        pages: store.pages.map((page) =>
          page.ownerId === owner && wanted.has(page.id)
            ? { ...page, read }
            : page
        ),
      };
    });

const markAllPages =
  (state: SavedPageStateRef) =>
  (owner: OwnerId): Effect.Effect<void> =>
    Ref.update(state, (store) => ({
      pages: store.pages.map((page) =>
        page.ownerId === owner ? { ...page, read: true } : page
      ),
    }));

const removePages =
  (state: SavedPageStateRef) =>
  (owner: OwnerId, ids: ReadonlyArray<SavedPageId>): Effect.Effect<void> =>
    Ref.update(state, (store) => {
      const wanted = new Set<string>(ids);

      return {
        pages: store.pages.filter(
          (page) => page.ownerId !== owner || !wanted.has(page.id)
        ),
      };
    });

const countUnreadPages =
  (state: SavedPageStateRef) =>
  (owner: OwnerId): Effect.Effect<number> =>
    Effect.map(
      Ref.get(state),
      (store) =>
        store.pages.filter((page) => page.ownerId === owner && !page.read)
          .length
    );

const makeSavedPageRepository = (
  state: SavedPageStateRef
): ISavedPageRepository => ({
  find: findPage(state),
  findByUrl: findPageByUrl(state),
  list: listPages(state),
  create: createPages(state),
  markRead: markPages(state),
  markAllRead: markAllPages(state),
  remove: removePages(state),
  unreadCount: countUnreadPages(state),
});

/** Builds a fresh, empty store per call, so each test gets its own state. */
export const memorySavedPageLayer = (
  decorate: (pages: ISavedPageRepository) => ISavedPageRepository = (pages) =>
    pages
): Layer.Layer<SavedPageRepository> =>
  Layer.effect(
    SavedPageRepository,
    Effect.map(Ref.make<MemorySavedPageState>({ pages: [] }), (state) =>
      decorate(makeSavedPageRepository(state))
    )
  );

export const MemorySavedPageRepositoryLive: Layer.Layer<SavedPageRepository> =
  memorySavedPageLayer();
