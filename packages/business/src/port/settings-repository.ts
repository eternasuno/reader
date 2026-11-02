import { Context, Data, type Effect } from 'effect';
import type { OwnerId } from '../entity/object-value';
import type { Setting } from '../entity/setting';

export class SettingsRepositoryReadError extends Data.TaggedError(
  'SettingsRepositoryReadError'
)<{
  readonly error: string;
}> {}

export class SettingsRepositoryWriteError extends Data.TaggedError(
  'SettingsRepositoryWriteError'
)<{
  readonly error: string;
}> {}

export const DEFAULT_RETENTION = 100;

export type SettingsRepositoryValue = Omit<Setting, 'ownerId' | 'jinaKey'> & {
  readonly jinaConfigured: boolean;
};

export type SettingsRepositoryUpdate = {
  readonly provider: Setting['provider'];
  readonly key?: Setting['jinaKey'];
  readonly browserEndpoint?: Setting['browserEndpoint'];
};

export interface ISettingsRepository {
  readonly get: (
    owner: OwnerId
  ) => Effect.Effect<SettingsRepositoryValue, SettingsRepositoryReadError>;
  readonly getKey: (
    owner: OwnerId
  ) => Effect.Effect<Setting['jinaKey'], SettingsRepositoryReadError>;
  readonly save: (
    owner: OwnerId,
    update: SettingsRepositoryUpdate
  ) => Effect.Effect<void, SettingsRepositoryWriteError>;
  readonly setRetention: (
    owner: OwnerId,
    retention: number
  ) => Effect.Effect<void, SettingsRepositoryWriteError>;
  readonly clearKey: (
    owner: OwnerId
  ) => Effect.Effect<void, SettingsRepositoryWriteError>;
  readonly clearBrowser: (
    owner: OwnerId
  ) => Effect.Effect<void, SettingsRepositoryWriteError>;
}

export class SettingsRepository extends Context.Service<
  SettingsRepository,
  ISettingsRepository
>()('reader/SettingsRepository') {}
