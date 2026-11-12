import { Effect, Layer, Option, Ref } from 'effect';
import type { NormalizedUrl } from '../../src/entity/common/normalized-url';
import type { OwnerId } from '../../src/entity/common/owner-id';
import type {
  SavedPage,
  SavedPageId,
} from '../../src/entity/saved-page/saved-page';
import {
  type ISavedPageRepository,
  type SavedPagePatch,
  type SavedPageQuery,
  SavedPageRepository,
} from '../../src/port/saved-page-repository';

type MemorySavedPageState = {
  readonly pages: ReadonlyArray<SavedPage>;
};

type Ref_ = Ref.Ref<MemorySavedPageState>;

const compareText = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
};

const isPageTaken = (
  pages: ReadonlyArray<SavedPage>,
  owner: OwnerId,
  row: SavedPage
): boolean =>
  row.ownerId !== owner ||
  pages.some((page) => page.id === row.id) ||
  pages.some(
    (page) => page.ownerId === row.ownerId && page.url.href === row.url.href
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
    if (isPageTaken(stored, owner, row)) {
      continue;
    }

    stored.push(row);
    created.push(row.id);
  }

  return { pages: stored, created };
};

const patchPage = (page: SavedPage, patch: SavedPagePatch): SavedPage => ({
  ...page,
  read: patch.read ?? page.read,
});

const findPage =
  (state: Ref_) =>
  (owner: OwnerId, id: SavedPageId): Effect.Effect<Option.Option<SavedPage>> =>
    Effect.map(Ref.get(state), (store) =>
      Option.fromUndefinedOr(
        store.pages.find((page) => page.ownerId === owner && page.id === id)
      )
    );

const findPageByUrl =
  (state: Ref_) =>
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
  (state: Ref_) =>
  (
    owner: OwnerId,
    query: SavedPageQuery
  ): Effect.Effect<ReadonlyArray<SavedPage>> =>
    Effect.map(Ref.get(state), (store) =>
      store.pages
        .filter((page) => page.ownerId === owner)
        .filter((page) => !query.unreadOnly || !page.read)
        .filter((page) => query.after === undefined || page.id < query.after)
        .sort((left, right) => compareText(right.id, left.id))
        .slice(0, query.limit)
    );

const createPages =
  (state: Ref_) =>
  (
    owner: OwnerId,
    pages: ReadonlyArray<SavedPage>
  ): Effect.Effect<ReadonlyArray<SavedPageId>> =>
    Ref.modify(state, (store) => {
      const inserted = insertPages(store.pages, owner, pages);

      return [inserted.created, { pages: inserted.pages }];
    });

const updatePages =
  (state: Ref_) =>
  (
    owner: OwnerId,
    ids: ReadonlyArray<SavedPageId>,
    patch: SavedPagePatch
  ): Effect.Effect<ReadonlyArray<SavedPageId>> =>
    Ref.modify(state, (store) => {
      const wanted = new Set<string>(ids);
      const matched: Array<SavedPageId> = [];
      const pages = store.pages.map((page) => {
        if (page.ownerId !== owner || !wanted.has(page.id)) {
          return page;
        }

        matched.push(page.id);

        return patchPage(page, patch);
      });

      return [matched, { pages }];
    });

const updateAllPages =
  (state: Ref_) =>
  (owner: OwnerId, patch: SavedPagePatch): Effect.Effect<void> =>
    Ref.update(state, (store) => ({
      pages: store.pages.map((page) =>
        page.ownerId === owner ? patchPage(page, patch) : page
      ),
    }));

const removePages =
  (state: Ref_) =>
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
  (state: Ref_) =>
  (owner: OwnerId): Effect.Effect<number> =>
    Effect.map(
      Ref.get(state),
      (store) =>
        store.pages.filter((page) => page.ownerId === owner && !page.read)
          .length
    );

const makeSavedPageRepository = (state: Ref_): ISavedPageRepository => ({
  find: findPage(state),
  findByUrl: findPageByUrl(state),
  list: listPages(state),
  create: createPages(state),
  update: updatePages(state),
  updateAll: updateAllPages(state),
  remove: removePages(state),
  unreadCount: countUnreadPages(state),
});

export const MemorySavedPageRepositoryLive: Layer.Layer<SavedPageRepository> =
  Layer.effect(
    SavedPageRepository,
    Effect.map(
      Ref.make<MemorySavedPageState>({ pages: [] }),
      makeSavedPageRepository
    )
  );
