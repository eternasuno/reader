import { expect, it } from '@effect/vitest';
import {
  FeedItemRepository,
  FeedRepository,
  FolderRepository,
  SavedPageRepository,
  SettingRepository,
} from '@reader/business';
import {
  alice,
  bob,
  feedItemQuery,
  itemRow,
  makeUniqueFeed,
  makeUniqueFolder,
  pageRow,
  savedPageQuery,
  storedFolder,
  storedFolderFeed,
} from '@reader/business/testing';
import { DateTime, Effect, Exit, Option } from 'effect';
import { SqlClient, type Statement } from 'effect/sql';
import { listAllFeeds, listKindleDueStatement } from '../src';
import { listFeedsStatement } from '../src/feed';
import {
  listAllStatement,
  listByFeedStatement,
  listByFolderStatement,
} from '../src/feed-item';
import { listFoldersStatement } from '../src/folder';
import { listSavedPagesStatement } from '../src/saved-page';
import { memoryDatabaseLayer, readerStoreDatabaseLayer } from './support';

const INDEX_NAMES = [
  'feed_item_owner_feed_id',
  'feed_item_owner_id',
  'feed_item_owner_read_id',
  'feed_owner_folder',
  'feed_owner_title',
  'saved_page_owner_id',
  'saved_page_owner_read_id',
  'setting_next_send_at',
];

const planOf = (
  sql: SqlClient.SqlClient,
  statement: Statement.Statement<unknown>
) => {
  const [query, params] = statement.compile();

  return sql
    .unsafe<{ readonly detail: string }>(`EXPLAIN QUERY PLAN ${query}`, params)
    .pipe(Effect.map((rows) => rows.map((row) => row.detail).join('\n')));
};

it.effect('turns foreign keys on for the reader connection', () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    expect(yield* sql`PRAGMA foreign_keys`).toEqual([{ foreign_keys: 1 }]);
  }).pipe(Effect.provide(memoryDatabaseLayer))
);

it.effect('migration 0001_reader creates the reader indexes', () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql.unsafe<{ readonly name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );

    expect(rows.map((row) => row.name)).toEqual(INDEX_NAMES);
  }).pipe(Effect.provide(memoryDatabaseLayer))
);

it.effect(
  'CM-OWN-2 rejects a feed item whose owner is not the feed owner',
  () =>
    Effect.gen(function* () {
      const feeds = yield* FeedRepository;
      const sql = yield* SqlClient.SqlClient;
      const feed = makeUniqueFeed();
      const item = itemRow(feed.id, { ownerId: bob });
      yield* feeds.create(alice, [feed]);

      const written = yield* Effect.exit(
        sql`INSERT INTO feed_item (id, owner, feed_id, url, title, read) VALUES (${item.id}, ${bob}, ${feed.id}, ${item.url.href}, ${item.title}, 0)`
      );

      expect(Exit.isFailure(written)).toBe(true);
    }).pipe(Effect.provide(readerStoreDatabaseLayer))
);

it.effect('decodes a NULL optional column as none', () =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const items = yield* FeedItemRepository;
    const sql = yield* SqlClient.SqlClient;
    const feed = makeUniqueFeed();
    const item = itemRow(feed.id);
    yield* feeds.create(alice, [feed]);

    yield* sql`INSERT INTO feed_item (id, owner, feed_id, url, title, description, content, extracted_content, published_at, read) VALUES (${item.id}, ${alice}, ${feed.id}, ${item.url.href}, ${item.title}, NULL, NULL, NULL, NULL, 0)`;

    const stored = Option.getOrThrow(yield* items.find(alice, item.id));

    expect(Option.isNone(stored.description)).toBe(true);
    expect(Option.isNone(stored.content)).toBe(true);
    expect(Option.isNone(stored.extractedContent)).toBe(true);
    expect(Option.isNone(stored.publishedAt)).toBe(true);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);

it.effect('the feed-item lists use their indexes', () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const feed = makeUniqueFeed();
    const folder = makeUniqueFolder();
    const cursors = [Option.none(), Option.some(itemRow(feed.id).id)];

    for (const cursor of cursors) {
      const query = feedItemQuery({ unread: false, cursor });
      const all = yield* planOf(sql, listAllStatement(sql, alice, query));
      const byFeed = yield* planOf(
        sql,
        listByFeedStatement(sql, alice, feed.id, query, 'newest')
      );
      const byFeedOldest = yield* planOf(
        sql,
        listByFeedStatement(sql, alice, feed.id, query, 'oldest')
      );
      const byFolder = yield* planOf(
        sql,
        listByFolderStatement(sql, alice, folder.id, query)
      );

      expect(all).toContain('INDEX feed_item_owner_id');
      expect(byFeed).toContain('INDEX feed_item_owner_feed_id');
      expect(byFeedOldest).toContain('INDEX feed_item_owner_feed_id');
      expect(byFolder).toContain('INDEX feed_item_owner_id');
      expect(byFolder).toContain('INDEX feed_owner_folder');
      for (const plan of [all, byFeed, byFeedOldest, byFolder]) {
        expect(plan).not.toContain('SCAN feed_item');
        expect(plan).not.toContain('SCAN feed');
        expect(plan).not.toContain('TEMP B-TREE');
      }
    }
  }).pipe(Effect.provide(memoryDatabaseLayer))
);

it.effect('the unread feed-item lists use the unread index', () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const feed = makeUniqueFeed();
    const folder = makeUniqueFolder();
    const cursors = [Option.none(), Option.some(itemRow(feed.id).id)];

    for (const cursor of cursors) {
      const query = feedItemQuery({ unread: true, cursor });
      const all = yield* planOf(sql, listAllStatement(sql, alice, query));
      const byFeed = yield* planOf(
        sql,
        listByFeedStatement(sql, alice, feed.id, query, 'newest')
      );
      const byFeedOldest = yield* planOf(
        sql,
        listByFeedStatement(sql, alice, feed.id, query, 'oldest')
      );
      const byFolder = yield* planOf(
        sql,
        listByFolderStatement(sql, alice, folder.id, query)
      );

      for (const plan of [all, byFeed, byFeedOldest, byFolder]) {
        expect(plan).toContain('INDEX feed_item_owner_read_id');
        expect(plan).not.toContain('SCAN feed_item');
        expect(plan).not.toContain('SCAN feed');
        expect(plan).not.toContain('TEMP B-TREE');
      }

      expect(byFolder).toContain('INDEX feed_owner_folder');
    }
  }).pipe(Effect.provide(memoryDatabaseLayer))
);

it.effect('the saved-page, feed and folder lists use their indexes', () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const cursors = [Option.none(), Option.some(pageRow().id)];

    for (const cursor of cursors) {
      const all = yield* planOf(
        sql,
        listSavedPagesStatement(
          sql,
          alice,
          savedPageQuery({ unread: false, cursor })
        )
      );
      const unread = yield* planOf(
        sql,
        listSavedPagesStatement(
          sql,
          alice,
          savedPageQuery({ unread: true, cursor })
        )
      );

      expect(all).toContain('INDEX saved_page_owner_id');
      expect(unread).toContain('INDEX saved_page_owner_read_id');
      for (const plan of [all, unread]) {
        expect(plan).not.toContain('SCAN saved_page');
        expect(plan).not.toContain('TEMP B-TREE');
      }
    }

    const feeds = yield* planOf(sql, listFeedsStatement(sql, alice));
    const folders = yield* planOf(sql, listFoldersStatement(sql, alice));

    expect(feeds).toContain('INDEX feed_owner_title');
    expect(feeds).not.toContain('SCAN feed');
    expect(feeds).not.toContain('TEMP B-TREE');
    expect(folders).toContain('INDEX sqlite_autoindex_folder_2');
    expect(folders).not.toContain('SCAN folder');
    expect(folders).not.toContain('TEMP B-TREE');
  }).pipe(Effect.provide(memoryDatabaseLayer))
);

it.effect('the Kindle due listing uses the next-send index', () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const plan = yield* planOf(
      sql,
      listKindleDueStatement(sql, DateTime.fromDateUnsafe(new Date(0)))
    );

    expect(plan).toContain('INDEX setting_next_send_at');
    expect(plan).not.toContain('SCAN setting');
  }).pipe(Effect.provide(memoryDatabaseLayer))
);

it.effect('saved pages survive removing their feed and folder', () =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const folders = yield* FolderRepository;
    const pages = yield* SavedPageRepository;
    const folder = yield* storedFolder();
    const feed = yield* storedFolderFeed(folder.id);
    const page = pageRow();
    yield* pages.create(alice, [page]);

    yield* feeds.remove(alice, [feed.id]);

    expect(Option.isSome(yield* pages.find(alice, page.id))).toBe(true);

    yield* storedFolderFeed(folder.id);
    yield* folders.remove(alice, [folder.id]);

    expect(Option.isSome(yield* pages.find(alice, page.id))).toBe(true);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);

it.effect('SET-GET-1 reads the defaults without writing a setting row', () =>
  Effect.gen(function* () {
    const settings = yield* SettingRepository;
    const sql = yield* SqlClient.SqlClient;

    yield* settings.get(alice);

    expect(yield* sql`SELECT owner FROM setting`).toEqual([]);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);

it.effect('FD-SCHED-1 lists the feeds of every owner for the scheduler', () =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const mine = makeUniqueFeed();
    const theirs = makeUniqueFeed({ ownerId: bob });
    yield* feeds.create(alice, [mine]);
    yield* feeds.create(bob, [theirs]);

    const listed = yield* listAllFeeds();

    expect(listed).toHaveLength(2);
    expect(listed).toEqual(
      expect.arrayContaining([
        { owner: alice, feedId: mine.id },
        { owner: bob, feedId: theirs.id },
      ])
    );
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);
