import { expect, it } from '@effect/vitest';
import {
  BrowserEndpoint,
  JinaKey,
  Retention,
  SettingRepository,
} from '@reader/business';
import { settingRepositoryContract } from '@reader/business/testing';
import { Effect, Option, Schema } from 'effect';
import { Database } from '../../src/infrastructure/db';
import {
  owner,
  query,
  settingStoreDatabaseLayer,
  settingStoreLayer,
} from './store-support';

const alice = owner('alice');

const decodeRetention = Schema.decodeSync(Retention);

const decodeJinaKey = Schema.decodeSync(JinaKey);

const decodeEndpoint = Schema.decodeSync(BrowserEndpoint);

settingRepositoryContract(settingStoreLayer);

it.effect('stores the fetcher leaves as plain text in one row', () =>
  Effect.gen(function* () {
    const settings = yield* SettingRepository;
    const db = yield* Database;

    yield* settings.update(alice, {
      feed: { retention: decodeRetention(60) },
      fetcher: {
        provider: 'browser',
        jina: { key: Option.some(decodeJinaKey('alice-secret')) },
        browser: {
          endpoint: Option.some(decodeEndpoint('http://127.0.0.1:9222')),
        },
      },
    });

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

it.effect('writes no row for a patch without leaves', () =>
  Effect.gen(function* () {
    const settings = yield* SettingRepository;
    const db = yield* Database;

    yield* settings.update(alice, {});
    yield* settings.update(alice, { feed: {} });
    yield* settings.update(alice, { fetcher: { jina: {} } });

    expect(yield* query(db, 'SELECT VALUE id FROM setting;')).toEqual([]);
  }).pipe(Effect.provide(settingStoreDatabaseLayer))
);

it.effect('reports an unreadable key without leaking it', () =>
  Effect.gen(function* () {
    const settings = yield* SettingRepository;
    const db = yield* Database;
    const secret = `leak-${'s'.repeat(2100)}`;

    yield* query(db, 'CREATE setting SET owner = $owner, jinaKey = $secret;', {
      owner: alice,
      secret,
    });

    const error = yield* Effect.flip(settings.get(alice));

    expect(error._tag).toBe('SettingRepositoryError');
    expect(error.message).not.toContain(secret);
  }).pipe(Effect.provide(settingStoreDatabaseLayer))
);
