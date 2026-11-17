import { Effect, Option } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { BrowserEndpoint } from '../../entity/setting/fetcher';
import {
  BrowserEndpointRequired,
  type SettingRepositoryError,
} from '../../error/setting';
import { SettingRepository } from '../../port/setting-repository';

/**
 * Chooses the browser service as the fetcher (SET-FETCH-2): the provider
 * becomes `browser`; a given endpoint replaces the stored one in the same
 * write, and none keeps the stored endpoint. Without a given endpoint and
 * without a stored one nothing is stored and it fails
 * `BrowserEndpointRequired` (SET-FETCH-3), so `browser` is never selected
 * without an endpoint (SET-FETCH-4). Because a stored endpoint can never be
 * cleared (SET-ENDPOINT-1), the read taken here cannot be invalidated; the
 * stored Jina key is untouched (SET-FETCH-5).
 */
export const useBrowser = Effect.fn('useBrowser')(function* (
  owner: OwnerId,
  endpoint: Option.Option<BrowserEndpoint>
) {
  const settings = yield* SettingRepository;

  if (Option.isSome(endpoint)) {
    return yield* settings.selectBrowserWithEndpoint(owner, endpoint.value);
  }

  const current = yield* settings.get(owner);

  if (Option.isNone(current.browserEndpoint)) {
    return yield* new BrowserEndpointRequired();
  }

  return yield* settings.selectBrowser(owner);
});

/** The failures of choosing the browser service (SET-FETCH-3). */
export type UseBrowserError = SettingRepositoryError | BrowserEndpointRequired;

/** The ports choosing the browser service runs on (SET-FETCH-2). */
export type UseBrowserPorts = SettingRepository;
