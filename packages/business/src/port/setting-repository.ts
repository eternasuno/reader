import { Context, Data, type Effect } from 'effect';
import type { OwnerId } from '../entity/common/owner-id';
import type { BrowserEndpoint, JinaKey } from '../entity/setting/fetcher';
import type { Retention } from '../entity/setting/retention';
import type { Setting } from '../entity/setting/setting';

/** A storage failure of the settings port. */
export class SettingRepositoryError extends Data.TaggedError(
  'SettingRepositoryError'
)<{ readonly message: string }> {}

/**
 * The six writers share one rule: each is one fixed write of the named fields
 * that leaves every other field as it is (CM-PORT-3). None of them returns
 * anything. The first write creates the owner's row with the defaults for the
 * other fields. Two concurrent writers of different fields both survive; for
 * the same field the last write wins. The port does not check SET-FETCH-4; the
 * operations that write these fields hold it. There is no writer that clears
 * the endpoint (SET-ENDPOINT-1).
 */
export interface ISettingRepository {
  /**
   * Returns the stored `Setting` with defaults filled in for anything not
   * stored (SET-GET-1).
   */
  readonly get: (
    owner: OwnerId
  ) => Effect.Effect<Setting, SettingRepositoryError>;
  /**
   * Writes `feed.retention`.
   */
  readonly setRetention: (
    owner: OwnerId,
    retention: Retention
  ) => Effect.Effect<void, SettingRepositoryError>;
  /**
   * Writes `fetcher.provider = "jina"`.
   */
  readonly selectJina: (
    owner: OwnerId
  ) => Effect.Effect<void, SettingRepositoryError>;
  /**
   * Writes `fetcher.provider = "jina"` and `fetcher.jina.key = some(key)` in one
   * write (SET-FETCH-1).
   */
  readonly selectJinaWithKey: (
    owner: OwnerId,
    key: JinaKey
  ) => Effect.Effect<void, SettingRepositoryError>;
  /**
   * Writes `fetcher.jina.key = none`. The provider is untouched (SET-KEY-1).
   */
  readonly clearJinaKey: (
    owner: OwnerId
  ) => Effect.Effect<void, SettingRepositoryError>;
  /**
   * Writes `fetcher.provider = "browser"`.
   */
  readonly selectBrowser: (
    owner: OwnerId
  ) => Effect.Effect<void, SettingRepositoryError>;
  /**
   * Writes `fetcher.provider = "browser"` and
   * `fetcher.browser.endpoint = some(endpoint)` in one write (SET-FETCH-2).
   */
  readonly selectBrowserWithEndpoint: (
    owner: OwnerId,
    endpoint: BrowserEndpoint
  ) => Effect.Effect<void, SettingRepositoryError>;
}

export class SettingRepository extends Context.Service<
  SettingRepository,
  ISettingRepository
>()('@reader/business/SettingRepository') {}
