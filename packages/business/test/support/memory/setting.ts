import { type DateTime, Effect, Layer, Option, Ref, Schema } from 'effect';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import type {
  BrowserEndpoint,
  JinaKey,
} from '../../../src/entity/setting/fetcher';
import type {
  KindleDelivery,
  SmtpPassword,
} from '../../../src/entity/setting/kindle';
import type { Retention } from '../../../src/entity/setting/retention';
import { Setting } from '../../../src/entity/setting/setting';
import {
  type ISettingRepository,
  SettingRepository,
} from '../../../src/port/setting-repository';

/** A user without stored settings reads the value the schema decodes (SET-GET-1). */
const defaultSetting = (ownerId: OwnerId): Setting =>
  Schema.decodeSync(Setting)({ ownerId });

type StoredSettings = Map<OwnerId, Setting>;

type SettingsRef = Ref.Ref<StoredSettings>;

const write = (
  rows: SettingsRef,
  owner: OwnerId,
  change: (current: Setting) => Setting
): Effect.Effect<void> =>
  Ref.update(rows, (stored) =>
    new Map(stored).set(
      owner,
      change(stored.get(owner) ?? defaultSetting(owner))
    )
  );

const makeSettingRepository = (rows: SettingsRef): ISettingRepository => ({
  get: (owner) =>
    Ref.get(rows).pipe(
      Effect.map((stored) => stored.get(owner) ?? defaultSetting(owner))
    ),
  setRetention: (owner: OwnerId, retention: Retention) =>
    write(rows, owner, (setting) => ({ ...setting, retention })),
  selectJina: (owner) =>
    write(rows, owner, (setting) => ({ ...setting, provider: 'jina' })),
  selectJinaWithKey: (owner, key: JinaKey) =>
    write(rows, owner, (setting) => ({
      ...setting,
      provider: 'jina',
      jinaKey: Option.some(key),
    })),
  clearJinaKey: (owner) =>
    write(rows, owner, (setting) => ({ ...setting, jinaKey: Option.none() })),
  selectBrowser: (owner) =>
    write(rows, owner, (setting) => ({ ...setting, provider: 'browser' })),
  selectBrowserWithEndpoint: (owner, endpoint: BrowserEndpoint) =>
    write(rows, owner, (setting) => ({
      ...setting,
      provider: 'browser',
      browserEndpoint: Option.some(endpoint),
    })),
  setKindle: (
    owner,
    kindle: KindleDelivery,
    password: Option.Option<SmtpPassword>,
    nextSendAt: Option.Option<DateTime.Utc>
  ) =>
    write(rows, owner, (setting) => ({
      ...setting,
      kindle: Option.some(kindle),
      smtpPassword: Option.isSome(password) ? password : setting.smtpPassword,
      nextSendAt,
    })),
  clearSmtpPassword: (owner) =>
    write(rows, owner, (setting) => ({
      ...setting,
      smtpPassword: Option.none(),
    })),
});

/** Builds a fresh, empty store per call, so each test gets its own state. */
export const memorySettingLayer = (
  decorate: (settings: ISettingRepository) => ISettingRepository = (settings) =>
    settings
): Layer.Layer<SettingRepository> =>
  Layer.effect(
    SettingRepository,
    Effect.map(Ref.make<StoredSettings>(new Map()), (rows) =>
      decorate(makeSettingRepository(rows))
    )
  );

export const MemorySettingRepositoryLive: Layer.Layer<SettingRepository> =
  memorySettingLayer();
