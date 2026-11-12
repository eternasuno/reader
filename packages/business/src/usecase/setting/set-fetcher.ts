import { Effect, Option, Schema } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import { BrowserEndpoint, JinaKey } from '../../entity/setting/fetcher';
import {
  SettingRepository,
  type SettingRepositoryError,
} from '../../port/setting-repository';
import { BrowserEndpointRequired } from './errors';

export const FetcherInput = Schema.Union([
  Schema.Struct({
    provider: Schema.Literals(['jina']),
    key: Schema.optionalKey(JinaKey),
  }),
  Schema.Struct({
    provider: Schema.Literals(['browser']),
    endpoint: Schema.optionalKey(BrowserEndpoint),
  }),
]);

export type FetcherInput = typeof FetcherInput.Type;

export const setFetcher = (
  owner: OwnerId,
  input: FetcherInput
): Effect.Effect<
  void,
  SettingRepositoryError | BrowserEndpointRequired,
  SettingRepository
> =>
  Effect.gen(function* () {
    const repository = yield* SettingRepository;

    if (input.provider === 'jina') {
      const jina =
        input.key === undefined
          ? {}
          : { jina: { key: Option.some(input.key) } };

      return yield* repository.update(owner, {
        fetcher: { provider: 'jina', ...jina },
      });
    }

    if (input.endpoint === undefined) {
      const current = yield* repository.get(owner);

      if (Option.isNone(current.fetcher.browser.endpoint)) {
        return yield* new BrowserEndpointRequired();
      }

      return yield* repository.update(owner, {
        fetcher: { provider: 'browser' },
      });
    }

    return yield* repository.update(owner, {
      fetcher: {
        provider: 'browser',
        browser: { endpoint: Option.some(input.endpoint) },
      },
    });
  });
