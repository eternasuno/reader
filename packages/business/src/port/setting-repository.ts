import { Context, type Effect } from 'effect';
import type { OwnerId } from '../entity/common/owner-id';
import type { BrowserEndpoint, JinaKey } from '../entity/setting/fetcher';
import type { Retention } from '../entity/setting/retention';
import type { Setting } from '../entity/setting/setting';
import type { SettingRepositoryError } from '../error/setting';

/**
 * Every method is scoped to the owner passed in (SET-OWN-1, CM-OWN-2).
 *
 * The write methods share one rule: each is one fixed write of the fields it
 * names and leaves every other field as it is (CM-PORT-3). The first write
 * creates the owner's row with the defaults of the other fields (SET-GET-1).
 * Two concurrent writers of different fields both survive; for the same field
 * the last write wins. The port does not check SET-FETCH-4: the operations that
 * write these fields hold that invariant. No method clears the endpoint, which
 * can only be replaced (SET-ENDPOINT-1).
 */
export interface ISettingRepository {
  /**
   * The stored `Setting` with the defaults filled in for anything not stored
   * (SET-GET-1). The boundary decides what of it is shown; the key and the
   * endpoint never leave the business layer (SET-GET-2, SET-VAL-4).
   */
  readonly get: (
    owner: OwnerId
  ) => Effect.Effect<Setting, SettingRepositoryError>;
  /** Writes `retention` (SET-FEED-1). */
  readonly setRetention: (
    owner: OwnerId,
    retention: Retention
  ) => Effect.Effect<void, SettingRepositoryError>;
  /** Writes `provider = "jina"` and keeps the stored key (SET-FETCH-1). */
  readonly selectJina: (
    owner: OwnerId
  ) => Effect.Effect<void, SettingRepositoryError>;
  /** Writes `provider = "jina"` and `jinaKey = some(key)` in one write (SET-FETCH-1). */
  readonly selectJinaWithKey: (
    owner: OwnerId,
    key: JinaKey
  ) => Effect.Effect<void, SettingRepositoryError>;
  /** Writes `jinaKey = none` and leaves the provider untouched (SET-KEY-1, SET-KEY-2). */
  readonly clearJinaKey: (
    owner: OwnerId
  ) => Effect.Effect<void, SettingRepositoryError>;
  /** Writes `provider = "browser"` and keeps the stored endpoint (SET-FETCH-2). */
  readonly selectBrowser: (
    owner: OwnerId
  ) => Effect.Effect<void, SettingRepositoryError>;
  /** Writes `provider = "browser"` and `browserEndpoint = some(endpoint)` in one write (SET-FETCH-2). */
  readonly selectBrowserWithEndpoint: (
    owner: OwnerId,
    endpoint: BrowserEndpoint
  ) => Effect.Effect<void, SettingRepositoryError>;
}

export class SettingRepository extends Context.Service<
  SettingRepository,
  ISettingRepository
>()('@reader/business/SettingRepository') {}
