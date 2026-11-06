import { Data, Effect, Option } from 'effect';
import type { OwnerId } from '../entity/object-value/owner-id';
import {
  type SettingsPatch,
  SettingsRepository,
} from '../port/settings-repository';

export class BrowserEndpointRequired extends Data.TaggedError(
  'BrowserEndpointRequired'
)<{
  readonly message: string;
}> {}

export const updateSettings = (owner: OwnerId, patch: SettingsPatch) =>
  Effect.gen(function* () {
    const settings = yield* SettingsRepository;
    const current = (yield* settings.get(owner)).fetcher;
    const provider = patch.fetcher?.provider ?? current.provider;
    const browser = patch.fetcher?.browser ?? current.browser;
    if (provider === 'browser' && Option.isNone(browser.endpoint)) {
      return yield* new BrowserEndpointRequired({
        message: 'Browser service address is required',
      });
    }

    yield* settings.update(owner, patch);
  });
