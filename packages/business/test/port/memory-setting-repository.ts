import { Effect, Layer, Ref, Schema } from 'effect';
import type { OwnerId } from '../../src/entity/common/owner-id';
import { Setting } from '../../src/entity/setting/setting';
import {
  type SettingPatch,
  SettingRepository,
} from '../../src/port/setting-repository';

const decodeSetting = Schema.decodeSync(Setting);

const defaultSetting = (ownerId: OwnerId): Setting =>
  decodeSetting({
    ownerId,
    feed: {},
    fetcher: { jina: {}, browser: {} },
  });

const applyPatch = (current: Setting, patch: SettingPatch): Setting => ({
  ownerId: current.ownerId,
  feed: {
    retention: patch.feed?.retention ?? current.feed.retention,
  },
  fetcher: {
    provider: patch.fetcher?.provider ?? current.fetcher.provider,
    jina: {
      key: patch.fetcher?.jina?.key ?? current.fetcher.jina.key,
    },
    browser: {
      endpoint:
        patch.fetcher?.browser?.endpoint ?? current.fetcher.browser.endpoint,
    },
  },
});

type StoredSettings = Map<OwnerId, Setting>;

const hasLeafFields = (patch: SettingPatch): boolean =>
  patch.feed?.retention !== undefined ||
  patch.fetcher?.provider !== undefined ||
  patch.fetcher?.jina?.key !== undefined ||
  patch.fetcher?.browser?.endpoint !== undefined;

const applyUpdate =
  (owner: OwnerId, patch: SettingPatch) =>
  (rows: StoredSettings): StoredSettings => {
    const current = rows.get(owner) ?? defaultSetting(owner);

    return new Map(rows).set(owner, applyPatch(current, patch));
  };

export const MemorySettingRepositoryLive = Layer.effect(
  SettingRepository,
  Effect.gen(function* () {
    const rows = yield* Ref.make<StoredSettings>(new Map());

    return SettingRepository.of({
      get: (owner) =>
        Ref.get(rows).pipe(
          Effect.map((current) => current.get(owner) ?? defaultSetting(owner))
        ),
      update: (owner, patch) =>
        hasLeafFields(patch)
          ? Ref.update(rows, applyUpdate(owner, patch))
          : Effect.void,
    });
  })
);
