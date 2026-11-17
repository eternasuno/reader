import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedItemRepository } from '../../../src/port/feed-item-repository';
import { listFolderItems } from '../../../src/usecase/feed-item/list-folder-items';
import {
  alice,
  bob,
  idsOf,
  itemRow,
  makeUniqueFolder,
  rowAt,
  storedFeed,
  storedFolder,
  storedFolderFeed,
} from '../../support/fixtures';
import { runItems } from './harness';

describe('listFolderItems', () => {
  it.effect('FD-LIST-6 lists the items of the feeds in the folder', () =>
    runItems(
      Effect.gen(function* () {
        const folder = yield* storedFolder();
        const inFolder = yield* storedFolderFeed(folder.id);
        const outside = yield* storedFeed();
        const items = yield* FeedItemRepository;
        const insideRow = itemRow(inFolder.id);
        const outsideRow = itemRow(outside.id);

        yield* items.create(alice, [insideRow, outsideRow]);

        const page = yield* listFolderItems(alice, folder.id, {
          limit: 10,
          unread: false,
          cursor: Option.none(),
        });

        expect(idsOf(page.items)).toStrictEqual([insideRow.id]);
        expect(page.cursor).toBeNull();
      })
    )
  );

  it.effect('FD-LIST-7 answers an empty page for an unknown folder', () =>
    runItems(
      Effect.gen(function* () {
        const page = yield* listFolderItems(alice, makeUniqueFolder().id, {
          limit: 10,
          unread: false,
          cursor: Option.none(),
        });

        expect(page).toStrictEqual({ items: [], cursor: null });
      })
    )
  );
});

describe('listFolderItems missing folders', () => {
  it.effect('FD-LIST-7 answers an empty page for another owner’s folder', () =>
    runItems(
      Effect.gen(function* () {
        const theirFolder = yield* storedFolder(bob);
        const theirFeed = yield* storedFolderFeed(theirFolder.id, bob);
        const items = yield* FeedItemRepository;

        yield* items.create(bob, [itemRow(theirFeed.id, { ownerId: bob })]);

        const page = yield* listFolderItems(alice, theirFolder.id, {
          limit: 10,
          unread: false,
          cursor: Option.none(),
        });

        expect(page).toStrictEqual({ items: [], cursor: null });
      })
    )
  );

  it.effect('FD-LIST-7 answers an empty page for an empty folder', () =>
    runItems(
      Effect.gen(function* () {
        const folder = yield* storedFolder();
        const page = yield* listFolderItems(alice, folder.id, {
          limit: 10,
          unread: false,
          cursor: Option.none(),
        });

        expect(page).toStrictEqual({ items: [], cursor: null });
      })
    )
  );
});

describe('listFolderItems paging', () => {
  it.effect('CM-PAGE-1 pages inside the folder scope', () =>
    runItems(
      Effect.gen(function* () {
        const folder = yield* storedFolder();
        const feed = yield* storedFolderFeed(folder.id);
        const items = yield* FeedItemRepository;
        const rows = [itemRow(feed.id), itemRow(feed.id), itemRow(feed.id)];

        yield* items.create(alice, rows);

        const first = yield* listFolderItems(alice, folder.id, {
          limit: 2,
          unread: false,
          cursor: Option.none(),
        });
        const second = yield* listFolderItems(alice, folder.id, {
          limit: 2,
          unread: false,
          cursor: Option.some(first.cursor ?? rowAt(rows, 0).id),
        });

        expect(idsOf(first.items)).toStrictEqual([
          rowAt(rows, 2).id,
          rowAt(rows, 1).id,
        ]);
        expect(first.cursor).toBe(rowAt(rows, 1).id);
        expect(idsOf(second.items)).toStrictEqual([rowAt(rows, 0).id]);
        expect(second.cursor).toBeNull();
      })
    )
  );
});
