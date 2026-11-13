import { Context, Data, type Effect } from 'effect';
import type { OwnerId } from '../entity/common/owner-id';
import type { BrowserEndpoint, JinaKey } from '../entity/setting/fetcher';
import type { Retention } from '../entity/setting/retention';
import type { Setting } from '../entity/setting/setting';

export class SettingRepositoryError extends Data.TaggedError(
  'SettingRepositoryError'
)<{ readonly message: string }> {}

export interface ISettingRepository {
  readonly get: (
    owner: OwnerId
  ) => Effect.Effect<Setting, SettingRepositoryError>;
  readonly setRetention: (
    owner: OwnerId,
    retention: Retention
  ) => Effect.Effect<void, SettingRepositoryError>;
  readonly selectJina: (
    owner: OwnerId
  ) => Effect.Effect<void, SettingRepositoryError>;
  readonly selectJinaWithKey: (
    owner: OwnerId,
    key: JinaKey
  ) => Effect.Effect<void, SettingRepositoryError>;
  readonly clearJinaKey: (
    owner: OwnerId
  ) => Effect.Effect<void, SettingRepositoryError>;
  readonly selectBrowser: (
    owner: OwnerId
  ) => Effect.Effect<void, SettingRepositoryError>;
  readonly selectBrowserWithEndpoint: (
    owner: OwnerId,
    endpoint: BrowserEndpoint
  ) => Effect.Effect<void, SettingRepositoryError>;
}

export class SettingRepository extends Context.Service<
  SettingRepository,
  ISettingRepository
>()('@reader/business/SettingRepository') {}
