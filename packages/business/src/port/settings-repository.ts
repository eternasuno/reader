import { Context, Data, type Effect } from 'effect';
import type { OwnerId } from '../entity/object-value';
import type { Setting } from '../entity/setting';

export class SettingsRepositoryError extends Data.TaggedError(
  'SettingsRepositoryError'
)<{
  readonly error: string;
}> {}

export const DEFAULT_RETENTION = 100;

export type SettingsRepositoryValue = Omit<Setting, 'ownerId' | 'jinaKey'> & {
  readonly jinaConfigured: boolean;
};

export type SettingsRepositoryUpdate = {
  readonly provider: Setting['provider'];
  /** `None` keeps the stored key. Use `clearKey` to remove it. */
  readonly key: Setting['jinaKey'];
  /**
   * `None` keeps the stored endpoint, `Some('')` clears it, and any other
   * `Some` value replaces it.
   */
  readonly browserEndpoint: Setting['browserEndpoint'];
};

export interface ISettingsRepository {
  readonly get: (
    owner: OwnerId
  ) => Effect.Effect<SettingsRepositoryValue, SettingsRepositoryError>;
  readonly getKey: (
    owner: OwnerId
  ) => Effect.Effect<Setting['jinaKey'], SettingsRepositoryError>;
  readonly save: (
    owner: OwnerId,
    update: SettingsRepositoryUpdate
  ) => Effect.Effect<void, SettingsRepositoryError>;
  readonly setRetention: (
    owner: OwnerId,
    retention: number
  ) => Effect.Effect<void, SettingsRepositoryError>;
  readonly clearKey: (
    owner: OwnerId
  ) => Effect.Effect<void, SettingsRepositoryError>;
  readonly clearBrowser: (
    owner: OwnerId
  ) => Effect.Effect<void, SettingsRepositoryError>;
}

export class SettingsRepository extends Context.Service<
  SettingsRepository,
  ISettingsRepository
>()('reader/SettingsRepository') {}
