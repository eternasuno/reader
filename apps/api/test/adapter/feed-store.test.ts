import { expect, it } from '@effect/vitest';
import { Feed, FeedRepository, FeedTitle } from '@reader/business';
import { feedRepositoryContract } from '@reader/business/testing';
import { DateTime, Effect, Exit, Option } from 'effect';
import { Database } from '../../src/infrastructure/db';
import {
  feedStoreLayer,
  owner,
  query,
  readerStoreDatabaseLayer,
  url,
} from './store-support';

const alice = owner('alice');

const feedRow = (path: string) =>
  Feed.make({
    ownerId: alice,
    url: url(path),
    title: FeedTitle.make('Feed'),
    updatedAt: Option.none(),
  });

feedRepositoryContract('SurrealDB FeedRepository', feedStoreLayer);

it.effect('stores the feed id as the record id and the url as text', () =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const db = yield* Database;
    const feed = feedRow('https://example.com/feed.xml');
    const updated = Feed.make({
      ...feedRow('https://example.com/updated.xml'),
      updatedAt: Option.some(
        DateTime.fromDateUnsafe(new Date('2026-01-01T00:00:00.000Z'))
      ),
    });

    yield* feeds.create(alice, [feed]);
    yield* feeds.create(alice, [updated]);

    expect(
      yield* query(db, 'SELECT VALUE id FROM feed WHERE feedId = $id;', {
        id: updated.id,
      })
    ).toEqual([updated.id]);
    expect(
      yield* query(db, 'SELECT VALUE url FROM feed ORDER BY url;')
    ).toEqual([feed.url.href, updated.url.href].sort());
    expect(
      yield* query(
        db,
        'SELECT VALUE type::is_datetime(updatedAt) FROM feed WHERE updatedAt != NONE;'
      )
    ).toEqual([true]);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);

it.effect('keeps one feed per owner and url in the database', () =>
  Effect.gen(function* () {
    const db = yield* Database;
    const feed = feedRow('https://example.com/duplicate.xml');

    yield* query(
      db,
      'CREATE feed SET owner = $owner, feedId = $id, url = $url, title = "Feed";',
      { owner: alice, id: feed.id, url: feed.url.href }
    );
    const duplicate = yield* Effect.exit(
      query(
        db,
        'CREATE feed SET owner = $owner, feedId = $id, url = $url, title = "Feed";',
        {
          owner: alice,
          id: feedRow('https://example.com/other.xml').id,
          url: feed.url.href,
        }
      )
    );

    expect(Exit.isFailure(duplicate)).toBe(true);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);
