import { createHash } from 'node:crypto';
import {
  BrowserEndpoint,
  FetcherProvider,
  JinaKey,
  OwnerId,
  Retention,
  type Setting,
  SettingRepository,
} from '@reader/business';
import { Effect, Redacted, Schema } from 'effect';
import type { Surreal } from 'surrealdb';
import { type Bindings, readRows, settingRepositoryError, write } from './sql';

const StoredSetting = Schema.Struct({
  ownerId: OwnerId,
  retention: Retention,
  provider: FetcherProvider,
  jinaKey: Schema.OptionFromOptional(JinaKey),
  browserEndpoint: Schema.OptionFromOptional(BrowserEndpoint),
});

const settingOf = (stored: typeof StoredSetting.Type): Setting => ({
  ownerId: stored.ownerId,
  feed: { retention: stored.retention },
  fetcher: {
    provider: stored.provider,
    jina: { key: stored.jinaKey },
    browser: { endpoint: stored.browserEndpoint },
  },
});

const ownerHash = (owner: OwnerId) =>
  createHash('sha256').update(owner).digest('hex');

const defaultRow = (owner: OwnerId) =>
  Schema.decodeUnknownSync(StoredSetting)({ ownerId: owner });

const load = (db: Surreal, owner: OwnerId) =>
  readRows(
    db,
    'SELECT owner AS ownerId, jinaKey, provider, browserEndpoint, retention FROM setting WHERE owner = $owner;',
    { owner },
    StoredSetting,
    settingRepositoryError
  ).pipe(Effect.map((rows) => settingOf(rows[0] ?? defaultRow(owner))));

const save = (
  db: Surreal,
  owner: OwnerId,
  sql: string,
  bindings: Bindings = {}
) =>
  write(
    db,
    sql,
    { owner, id: ownerHash(owner), ...bindings },
    settingRepositoryError
  );

export const makeSettingRepository = (db: Surreal) =>
  SettingRepository.of({
    get: (owner) => load(db, owner),
    setRetention: (owner, retention) =>
      save(
        db,
        owner,
        'UPSERT type::record("setting", $id) SET owner = $owner, retention = $retention;',
        { retention }
      ),
    selectJina: (owner) =>
      save(
        db,
        owner,
        'UPSERT type::record("setting", $id) SET owner = $owner, provider = \'jina\';'
      ),
    selectJinaWithKey: (owner, key) =>
      save(
        db,
        owner,
        'UPSERT type::record("setting", $id) SET owner = $owner, provider = \'jina\', jinaKey = $jinaKey;',
        { jinaKey: Redacted.value(key) }
      ),
    clearJinaKey: (owner) =>
      save(
        db,
        owner,
        'UPSERT type::record("setting", $id) SET owner = $owner, jinaKey = NONE;'
      ),
    selectBrowser: (owner) =>
      save(
        db,
        owner,
        'UPSERT type::record("setting", $id) SET owner = $owner, provider = \'browser\';'
      ),
    selectBrowserWithEndpoint: (owner, endpoint) =>
      save(
        db,
        owner,
        'UPSERT type::record("setting", $id) SET owner = $owner, provider = \'browser\', browserEndpoint = $browserEndpoint;',
        { browserEndpoint: Redacted.value(endpoint).href }
      ),
  });
