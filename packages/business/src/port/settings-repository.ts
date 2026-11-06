import { Context, Data, type Effect, Schema } from 'effect';
import type { OwnerId } from '../entity/object-value';
import { FetcherSetting, Retention, type Setting } from '../entity/setting';

export class SettingsRepositoryError extends Data.TaggedError(
  'SettingsRepositoryError'
)<{
  readonly message: string;
}> {}

export const SettingsPatch = Schema.Struct({
  retention: Schema.optionalKey(Retention),
  fetcher: Schema.optionalKey(FetcherSetting),
});

export type SettingsPatch = typeof SettingsPatch.Type;

export type ISettingsRepository = {
  readonly get: (
    owner: OwnerId
  ) => Effect.Effect<Setting, SettingsRepositoryError>;
  readonly update: (
    owner: OwnerId,
    settingsPatch: SettingsPatch
  ) => Effect.Effect<void, SettingsRepositoryError>;
};

export class SettingsRepository extends Context.Service<
  SettingsRepository,
  ISettingsRepository
>()('reader/SettingsRepository') {}
