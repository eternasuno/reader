import { expect, it } from '@effect/vitest';
import {
  BrowserEndpoint,
  JinaKey,
  OwnerId,
  Retention,
  SettingRepository,
} from '@reader/business';
import { settingRepositoryContract } from '@reader/business/testing';
import { Effect, Schema } from 'effect';
import { SqlClient } from 'effect/sql';
import { readerStoreDatabaseLayer, settingStoreLayer } from '../support';

const alice = OwnerId.make('alice');

const decodeRetention = Schema.decodeSync(Retention);

const decodeJinaKey = Schema.decodeSync(JinaKey);

const decodeEndpoint = Schema.decodeSync(BrowserEndpoint);

settingRepositoryContract(settingStoreLayer);

it.effect('stores the fetcher leaves as plain text in one row', () =>
  Effect.gen(function* () {
    const settings = yield* SettingRepository;
    const sql = yield* SqlClient.SqlClient;

    yield* settings.setRetention(alice, decodeRetention(60));
    yield* settings.selectJinaWithKey(alice, decodeJinaKey('alice-secret'));
    yield* settings.selectBrowserWithEndpoint(
      alice,
      decodeEndpoint('http://127.0.0.1:9222')
    );

    const rows =
      yield* sql`SELECT owner, provider, jina_key AS jinaKey, browser_endpoint AS browserEndpoint, retention FROM setting`;

    expect(rows).toEqual([
      {
        owner: alice,
        provider: 'browser',
        jinaKey: 'alice-secret',
        browserEndpoint: 'http://127.0.0.1:9222/',
        retention: 60,
      },
    ]);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);

it.effect('reads the defaults without writing a row', () =>
  Effect.gen(function* () {
    const settings = yield* SettingRepository;
    const sql = yield* SqlClient.SqlClient;

    yield* settings.get(alice);

    expect(yield* sql`SELECT owner FROM setting`).toEqual([]);
  }).pipe(Effect.provide(readerStoreDatabaseLayer))
);
