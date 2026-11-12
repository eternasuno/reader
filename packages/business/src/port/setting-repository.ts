import { Context, Data, type Effect, Schema, Struct } from 'effect';
import type { OwnerId } from '../entity/common/owner-id';
import {
  BrowserSetting,
  FetcherProvider,
  JinaSetting,
} from '../entity/setting/fetcher';
import { FeedSetting, type Setting } from '../entity/setting/setting';

export class SettingRepositoryError extends Data.TaggedError(
  'SettingRepositoryError'
)<{ readonly message: string }> {}

const optionalFields = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Struct.map(fields, Schema.optionalKey);

export const SettingPatch = Schema.Struct({
  feed: Schema.optionalKey(FeedSetting.mapFields(optionalFields)),
  fetcher: Schema.optionalKey(
    Schema.Struct({
      provider: Schema.optionalKey(FetcherProvider),
      jina: Schema.optionalKey(JinaSetting.mapFields(optionalFields)),
      browser: Schema.optionalKey(BrowserSetting.mapFields(optionalFields)),
    })
  ),
});

export type SettingPatch = typeof SettingPatch.Type;

export interface ISettingRepository {
  readonly get: (
    owner: OwnerId
  ) => Effect.Effect<Setting, SettingRepositoryError>;
  readonly update: (
    owner: OwnerId,
    patch: SettingPatch
  ) => Effect.Effect<void, SettingRepositoryError>;
}

export class SettingRepository extends Context.Service<
  SettingRepository,
  ISettingRepository
>()('@reader/business/SettingRepository') {}
