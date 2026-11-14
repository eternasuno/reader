import { Effect, Layer, Option, Ref, Schema } from 'effect';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import { Setting } from '../../../src/entity/setting/setting';
import { SettingRepository } from '../../../src/port/setting-repository';

const decodeSetting = Schema.decodeSync(Setting);

const defaultSetting = (ownerId: OwnerId): Setting =>
  decodeSetting({
    ownerId,
    feed: {},
    fetcher: { jina: {}, browser: {} },
  });

type StoredSettings = Map<OwnerId, Setting>;

const write = (
  rows: Ref.Ref<StoredSettings>,
  owner: OwnerId,
  change: (current: Setting) => Setting
): Effect.Effect<void> =>
  Ref.update(rows, (map) =>
    new Map(map).set(owner, change(map.get(owner) ?? defaultSetting(owner)))
  );

export const MemorySettingRepositoryLive = Layer.effect(
  SettingRepository,
  Effect.gen(function* () {
    const rows = yield* Ref.make<StoredSettings>(new Map());

    return SettingRepository.of({
      get: (owner) =>
        Ref.get(rows).pipe(
          Effect.map((current) => current.get(owner) ?? defaultSetting(owner))
        ),
      setRetention: (owner, retention) =>
        write(rows, owner, (s) => ({ ...s, feed: { retention } })),
      selectJina: (owner) =>
        write(rows, owner, (s) => ({
          ...s,
          fetcher: { ...s.fetcher, provider: 'jina' },
        })),
      selectJinaWithKey: (owner, key) =>
        write(rows, owner, (s) => ({
          ...s,
          fetcher: {
            ...s.fetcher,
            provider: 'jina',
            jina: { key: Option.some(key) },
          },
        })),
      clearJinaKey: (owner) =>
        write(rows, owner, (s) => ({
          ...s,
          fetcher: { ...s.fetcher, jina: { key: Option.none() } },
        })),
      selectBrowser: (owner) =>
        write(rows, owner, (s) => ({
          ...s,
          fetcher: { ...s.fetcher, provider: 'browser' },
        })),
      selectBrowserWithEndpoint: (owner, endpoint) =>
        write(rows, owner, (s) => ({
          ...s,
          fetcher: {
            ...s.fetcher,
            provider: 'browser',
            browser: { endpoint: Option.some(endpoint) },
          },
        })),
    });
  })
);
