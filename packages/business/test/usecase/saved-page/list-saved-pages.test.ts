import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { SavedPageRepository } from '../../../src/port/saved-page-repository';
import { listSavedPages } from '../../../src/usecase/saved-page/list-saved-pages';
import { alice, idsOf, makeUniqueSavedPage } from '../../support/fixtures';
import { run } from '../../support/usecase/saved-page';

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
