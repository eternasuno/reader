import { Effect, Option } from 'effect';
import type { BrowserEndpoint, JinaKey } from '../../entity/setting/fetcher';
import type { Setting } from '../../entity/setting/setting';

export type ActiveFetcher =
  | { readonly _tag: 'Jina'; readonly key: Option.Option<JinaKey> }
  | { readonly _tag: 'Browser'; readonly endpoint: BrowserEndpoint };

export const activeFetcher = (
  setting: Setting
): Effect.Effect<ActiveFetcher> => {
  if (setting.fetcher.provider === 'jina') {
    return Effect.succeed({ _tag: 'Jina', key: setting.fetcher.jina.key });
  }

  return Option.match(setting.fetcher.browser.endpoint, {
    onNone: () =>
      Effect.die(
        new Error(
          'SET-FETCH-4 violated: the browser provider is selected without a stored endpoint'
        )
      ),
    onSome: (endpoint) => Effect.succeed({ _tag: 'Browser', endpoint }),
  });
};
