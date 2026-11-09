import { Context, Data, type Effect, Schema, Struct } from 'effect';
import type { OwnerId } from '../entity/object-value/owner-id';
import { FeedSetting } from '../entity/setting/feed';
import { FetcherSetting } from '../entity/setting/fetcher';
import type { Setting } from '../entity/setting/setting';

export class SettingsRepositoryError extends Data.TaggedError(
  'SettingsRepositoryError'
)<{
  readonly message: string;
}> {}

export const SettingsPatch = Schema.Struct({
  feed: Schema.optionalKey(
    FeedSetting.mapFields((fields) => Struct.map(fields, Schema.optionalKey))
  ),
  fetcher: Schema.optionalKey(
    FetcherSetting.mapFields((fields) => Struct.map(fields, Schema.optionalKey))
  ),
});

export type SettingsPatch = typeof SettingsPatch.Type;

export interface ISettingsRepository {
  readonly get: (
    owner: OwnerId
  ) => Effect.Effect<Setting, SettingsRepositoryError>;
  readonly update: (
    owner: OwnerId,
    settingsPatch: SettingsPatch
  ) => Effect.Effect<void, SettingsRepositoryError>;
}

export class SettingsRepository extends Context.Service<
  SettingsRepository,
  ISettingsRepository
>()('reader/SettingsRepository') {}
