import { expect, it } from '@effect/vitest';
import {
  BrowserEndpoint,
  JinaKey,
  Retention,
  SettingRepository,
} from '@reader/business';
import { settingRepositoryContract } from '@reader/business/testing';
import { Effect, Schema } from 'effect';
import { Database } from '../../src/db';
import {
  owner,
  query,
  settingStoreDatabaseLayer,
  settingStoreLayer,
} from '../support/store';

const alice = owner('alice');

const decodeRetention = Schema.decodeSync(Retention);

const decodeJinaKey = Schema.decodeSync(JinaKey);

const decodeEndpoint = Schema.decodeSync(BrowserEndpoint);

settingRepositoryContract(settingStoreLayer);

it.effect('stores the fetcher leaves as plain text in one row', () =>
  Effect.gen(function* () {
    const settings = yield* SettingRepository;
    const db = yield* Database;

    yield* settings.setRetention(alice, decodeRetention(60));
    yield* settings.selectJinaWithKey(alice, decodeJinaKey('alice-secret'));
    yield* settings.selectBrowserWithEndpoint(
      alice,
      decodeEndpoint('http://127.0.0.1:9222')
    );

    expect(
      yield* query(
        db,
        'SELECT owner, provider, jinaKey, browserEndpoint, retention FROM setting;'
      )
    ).toEqual([
      {
        owner: alice,
        provider: 'browser',
        jinaKey: 'alice-secret',
        browserEndpoint: 'http://127.0.0.1:9222/',
        retention: 60,
      },
    ]);
  }).pipe(Effect.provide(settingStoreDatabaseLayer))
);

it.effect('reads the defaults without writing a row', () =>
  Effect.gen(function* () {
    const settings = yield* SettingRepository;
    const db = yield* Database;

    yield* settings.get(alice);

    expect(yield* query(db, 'SELECT VALUE id FROM setting;')).toEqual([]);
  }).pipe(Effect.provide(settingStoreDatabaseLayer))
);
