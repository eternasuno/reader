import { Context, Data, type Effect, Schema, Struct } from 'effect';
import type { OwnerId } from '../entity/object-value';
import { Setting } from '../entity/setting';

export class SettingsRepositoryError extends Data.TaggedError(
  'SettingsRepositoryError'
)<{
  readonly message: string;
}> {}

export const SettingsPatch = Setting.mapFields((fields) =>
  Struct.map(
    Struct.pick(fields, [
      'retention',
      'provider',
      'jinaKey',
      'browserEndpoint',
    ]),
    Schema.optionalKey
  )
);

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
