import { Effect, Option } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { BrowserEndpoint } from '../../entity/setting/fetcher';
import {
  SettingRepository,
  type SettingRepositoryError,
} from '../../port/setting-repository';
import { BrowserEndpointRequired } from './errors';

export const useBrowser = (
  owner: OwnerId,
  endpoint?: BrowserEndpoint
): Effect.Effect<
  void,
  SettingRepositoryError | BrowserEndpointRequired,
  SettingRepository
> =>
  Effect.gen(function* () {
    const repository = yield* SettingRepository;

    if (endpoint !== undefined) {
      return yield* repository.selectBrowserWithEndpoint(owner, endpoint);
    }

    const current = yield* repository.get(owner);

    if (Option.isNone(current.fetcher.browser.endpoint)) {
      return yield* new BrowserEndpointRequired();
    }

    return yield* repository.selectBrowser(owner);
  });
