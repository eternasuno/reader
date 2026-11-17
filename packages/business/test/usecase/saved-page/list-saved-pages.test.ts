import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import {
  type ISavedPageRepository,
  type SavedPageQuery,
  SavedPageRepository,
} from '../../../src/port/saved-page-repository';
import { listSavedPages } from '../../../src/usecase/saved-page/list-saved-pages';
import { alice, bob, idsOf, makeUniqueSavedPage } from '../../support/fixtures';
import { run } from './harness';

describe('listSavedPages order', () => {
  it.effect('SP-LIST-1 lists the newest page first', () =>
    run(
      Effect.gen(function* () {
        const pages = yield* SavedPageRepository;
        const older = makeUniqueSavedPage();
        const newer = makeUniqueSavedPage();

        yield* pages.create(alice, [older, newer]);

        const page = yield* listSavedPages(alice, {
          limit: 10,
          unread: false,
          cursor: Option.none(),
        });

        expect(idsOf(page.items)).toStrictEqual([newer.id, older.id]);
        expect(page.cursor).toBeNull();
      })
    )
  );

  it.effect('SP-LIST-2 never lists another owner’s pages', () =>
    run(
      Effect.gen(function* () {
        const pages = yield* SavedPageRepository;
        const mine = makeUniqueSavedPage();
        const theirs = makeUniqueSavedPage({ ownerId: bob });

        yield* pages.create(alice, [mine]);
        yield* pages.create(bob, [theirs]);

        const page = yield* listSavedPages(alice, {
          limit: 10,
          unread: false,
          cursor: Option.none(),
        });

        expect(idsOf(page.items)).toStrictEqual([mine.id]);
      })
    )
  );
});

describe('listSavedPages paging', () => {
  it.effect('CM-PAGE-4 asks the repository for one row more than asked', () =>
    run(
      Effect.gen(function* () {
        const pages = yield* SavedPageRepository;
        const queries: Array<SavedPageQuery> = [];
        const recording: ISavedPageRepository = {
          ...pages,
          list: (owner, query) => {
            queries.push(query);

            return pages.list(owner, query);
          },
        };

        yield* pages.create(alice, [makeUniqueSavedPage()]);

        const page = yield* listSavedPages(alice, {
          limit: 1,
          unread: true,
          cursor: Option.none(),
        }).pipe(Effect.provideService(SavedPageRepository, recording));

        expect(queries).toStrictEqual([
          { limit: 2, unread: true, cursor: Option.none() },
        ]);
        expect(page.items).toHaveLength(1);
        expect(page.cursor).toBeNull();
      })
    )
  );
});

describe('listSavedPages cursor', () => {
  it.effect(
    'CM-PAGE-4 pages after the cursor and ends with a null cursor',
    () =>
      run(
        Effect.gen(function* () {
          const pages = yield* SavedPageRepository;
          const oldest = makeUniqueSavedPage();
          const middle = makeUniqueSavedPage();
          const newest = makeUniqueSavedPage();

          yield* pages.create(alice, [oldest, middle, newest]);

          const first = yield* listSavedPages(alice, {
            limit: 2,
            unread: false,
            cursor: Option.none(),
          });
          const second = yield* listSavedPages(alice, {
            limit: 2,
            unread: false,
            cursor: Option.some(first.cursor ?? oldest.id),
          });

          expect(idsOf(first.items)).toStrictEqual([newest.id, middle.id]);
          expect(first.cursor).toBe(middle.id);
          expect(idsOf(second.items)).toStrictEqual([oldest.id]);
          expect(second.cursor).toBeNull();
        })
      )
  );
});

describe('listSavedPages unread filter', () => {
  it.effect(
    'SP-LIST-3 applies the unread filter afresh from the first page',
    () =>
      run(
        Effect.gen(function* () {
          const pages = yield* SavedPageRepository;
          const read = makeUniqueSavedPage({ read: true });
          const unread = makeUniqueSavedPage();

          yield* pages.create(alice, [read, unread]);
          yield* pages.markRead(alice, [unread.id], true);

          const filtered = yield* listSavedPages(alice, {
            limit: 10,
            unread: true,
            cursor: Option.none(),
          });
          const all = yield* listSavedPages(alice, {
            limit: 10,
            unread: false,
            cursor: Option.none(),
          });

          expect(filtered.items).toStrictEqual([]);
          expect(filtered.cursor).toBeNull();
          expect(idsOf(all.items)).toStrictEqual([unread.id, read.id]);
        })
      )
  );
});
