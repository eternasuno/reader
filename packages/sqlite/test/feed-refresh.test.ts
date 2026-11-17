import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { SqlClient } from 'effect/sql';
import { listRefreshFeeds, readerSqliteLayer } from '../src';
import { readerDatabaseLayer } from './support';

const failedListing = Effect.flip(listRefreshFeeds);

it.effect('maps a missing feed table to FeedListingError', () =>
  Effect.gen(function* () {
    const error = yield* failedListing;

    expect(error._tag).toBe('FeedListingError');
    expect(error.message).toBe('Failed to read feeds');
    expect(error.cause).toMatchObject({ _tag: 'SqlError' });
    expect(
      (error.cause as { reason: { cause: { message: string } } }).reason.cause
        .message
    ).toContain('no such table: feed');
  }).pipe(Effect.provide(readerSqliteLayer(':memory:')))
);

it.effect('maps an undecodable feed id to FeedListingError', () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    yield* sql`INSERT INTO feed (id, owner, url, title) VALUES (${'not-a-feed-id'}, ${'alice'}, ${'https://example.com/feed.xml'}, ${'Feed'})`;

    const error = yield* failedListing;

    expect(error._tag).toBe('FeedListingError');
    expect(error.message).toBe('Failed to read feeds');
    expect(error.cause).toMatchObject({ _tag: 'SchemaError' });
    expect((error.cause as { message: string }).message).toContain('feedId');
  }).pipe(Effect.provide(readerDatabaseLayer))
);
