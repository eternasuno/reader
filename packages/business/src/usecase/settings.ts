import { Data, Effect, Option } from 'effect';
import type { OwnerId } from '../entity/object-value/owner-id';
import type { Setting } from '../entity/setting/setting';
import {
  type SettingsPatch,
  SettingsRepository,
} from '../port/settings-repository';

export class BrowserEndpointRequired extends Data.TaggedError(
  'BrowserEndpointRequired'
)<{
  readonly message: string;
}> {}

const requireBrowserEndpoint = (
  current: Setting['fetcher'],
  fetcher: NonNullable<SettingsPatch['fetcher']>
) => {
  const provider = fetcher.provider ?? current.provider;
  const browser = fetcher.browser ?? current.browser;

  return provider === 'browser' && Option.isNone(browser.endpoint)
    ? Effect.fail(
        new BrowserEndpointRequired({
          message: 'Browser service address is required',
        })
      )
    : Effect.void;
};

export const updateSettings = (owner: OwnerId, patch: SettingsPatch) =>
  Effect.gen(function* () {
    const settings = yield* SettingsRepository;
    if (patch.fetcher !== undefined) {
      const current = (yield* settings.get(owner)).fetcher;
      yield* requireBrowserEndpoint(current, patch.fetcher);
    }

    yield* settings.update(owner, patch);
  });
