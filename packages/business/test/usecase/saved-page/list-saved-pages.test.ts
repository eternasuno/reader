import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { SavedPageRepository } from '../../../src/port/saved-page-repository';
import { addSavedPage } from '../../../src/usecase/saved-page/add-saved-page';
import { listSavedPages } from '../../../src/usecase/saved-page/list-saved-pages';
import {
  alice,
  bob,
  decodeUrl,
  idsOf,
  makeUniqueSavedPage,
} from '../../support';
import { run } from './support';

describe('listSavedPages', () => {
  it.effect('SP-LIST-1 returns the newest page first', () =>
    run(
      Effect.gen(function* () {
        const repository = yield* SavedPageRepository;
        const first = makeUniqueSavedPage();
        const second = makeUniqueSavedPage();
        const third = makeUniqueSavedPage();

        yield* repository.create(alice, [first, second, third]);

        const listed = yield* listSavedPages(alice, {
          unreadOnly: false,
          limit: 10,
        });

        expect(listed.cursor).toBeNull();
        expect(idsOf(listed.items)).toEqual([third.id, second.id, first.id]);
      })
    )
  );

  it.effect('CM-PAGE-4 returns no cursor when the page is exactly full', () =>
    run(
      Effect.gen(function* () {
        const repository = yield* SavedPageRepository;
        const first = makeUniqueSavedPage();
        const second = makeUniqueSavedPage();

        yield* repository.create(alice, [first, second]);

        const listed = yield* listSavedPages(alice, {
          unreadOnly: false,
          limit: 2,
        });

        expect(idsOf(listed.items)).toEqual([second.id, first.id]);
        expect(listed.cursor).toBeNull();
      })
    )
  );
});

describe('listSavedPages cursor', () => {
  it.effect('CM-PAGE-4 pages with the id of the last returned row', () =>
    run(
      Effect.gen(function* () {
        const repository = yield* SavedPageRepository;
        const first = makeUniqueSavedPage();
        const second = makeUniqueSavedPage();
        const third = makeUniqueSavedPage();

        yield* repository.create(alice, [first, second, third]);

        const head = yield* listSavedPages(alice, {
          unreadOnly: false,
          limit: 2,
        });

        expect(idsOf(head.items)).toEqual([third.id, second.id]);
        expect(head.cursor).toBe(second.id);

        if (head.cursor === null) {
          throw new Error('expected a cursor');
        }

        const tail = yield* listSavedPages(alice, {
          unreadOnly: false,
          limit: 2,
          cursor: head.cursor,
        });

        expect(idsOf(tail.items)).toEqual([first.id]);
        expect(tail.cursor).toBeNull();
      })
    )
  );
});

describe('listSavedPages filters', () => {
  it.effect('CM-PAGE-8 SP-LIST-3 filters unread pages on every listing', () =>
    run(
      Effect.gen(function* () {
        const repository = yield* SavedPageRepository;
        const first = makeUniqueSavedPage();
        const second = makeUniqueSavedPage();
        const third = makeUniqueSavedPage();

        yield* repository.create(alice, [first, second, third]);
        yield* repository.update(alice, [third.id], { read: true });

        const unread = yield* listSavedPages(alice, {
          unreadOnly: true,
          limit: 10,
        });

        expect(idsOf(unread.items)).toEqual([second.id, first.id]);

        const all = yield* listSavedPages(alice, {
          unreadOnly: false,
          limit: 10,
        });

        expect(idsOf(all.items)).toEqual([third.id, second.id, first.id]);
      })
    )
  );

  it.effect('SP-LIST-2 returns only the owner pages', () =>
    run(
      Effect.gen(function* () {
        const repository = yield* SavedPageRepository;
        const mine = makeUniqueSavedPage();
        const theirs = makeUniqueSavedPage({ ownerId: bob });

        yield* repository.create(alice, [mine]);
        yield* repository.create(bob, [theirs]);

        const listed = yield* listSavedPages(alice, {
          unreadOnly: false,
          limit: 10,
        });

        expect(idsOf(listed.items)).toEqual([mine.id]);
      })
    )
  );
});

describe('listSavedPages after removal', () => {
  it.effect('SP-REMOVE-2 re-adds the same url as a new page on top', () =>
    run(
      Effect.gen(function* () {
        const repository = yield* SavedPageRepository;
        const url = decodeUrl('https://example.com/reread');
        const first = yield* addSavedPage(alice, url);
        const other = yield* addSavedPage(
          alice,
          decodeUrl('https://example.com/other')
        );

        yield* repository.remove(alice, [first.id]);

        const again = yield* addSavedPage(alice, url);
        const listed = yield* listSavedPages(alice, {
          unreadOnly: false,
          limit: 10,
        });

        expect(again.id).not.toBe(first.id);
        expect(again.id > other.id).toBe(true);
        expect(again.read).toBe(false);
        expect(again.url.href).toBe(url.href);
        expect(idsOf(listed.items)).toEqual([again.id, other.id]);
      })
    )
  );
});
