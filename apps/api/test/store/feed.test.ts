import { expect, it } from '@effect/vitest';
import { Feed, FeedRepository, FeedTitle } from '@reader/business';
import { feedRepositoryContract } from '@reader/business/testing';
import { DateTime, Effect, Option } from 'effect';
import { Database } from '../../src/db';
import {
  feedStoreLayer,
  owner,
  query,
  readerStoreDatabaseLayer,
  url,
} from '../support/store';

const alice = owner('alice');

const feedRow = (path: string) =>
  Feed.make({
    ownerId: alice,
    url: url(path),
    title: FeedTitle.make('Feed'),
    folderId: Option.none(),
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
