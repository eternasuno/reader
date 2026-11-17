import { Effect, Option } from 'effect';
import type { BrowserEndpoint, JinaKey } from '../../entity/setting/fetcher';
import type { Setting } from '../../entity/setting/setting';

/**
 * The fetcher an owner's setting selects, as a closed union the outer layer
 * maps to a `WebpageFetcher` by exhaustive match (SET-ACTIVE-1, SET-ACTIVE-3).
 */
export type ActiveFetcher =
  | { readonly _tag: 'Jina'; readonly key: Option.Option<JinaKey> }
  | { readonly _tag: 'Browser'; readonly endpoint: BrowserEndpoint };

/**
 * The fetcher in effect for one owner's setting (SET-ACTIVE): `jina` gives
 * `Jina` with the stored key, which may be none, and `browser` gives `Browser`
 * with the stored endpoint. `browser` without an endpoint cannot occur
 * (SET-FETCH-4); it never falls back to Jina and is surfaced as a defect
 * (SET-ACTIVE-2). No other field of the setting is read (SET-ACTIVE-3).
 */
export const activeFetcher = Effect.fn('activeFetcher')(function* (
  setting: Setting
) {
  if (setting.provider === 'jina') {
    return { _tag: 'Jina', key: setting.jinaKey } satisfies ActiveFetcher;
  }

  if (Option.isNone(setting.browserEndpoint)) {
    return yield* Effect.die(
      new Error(
        'SET-FETCH-4 violated: the browser provider is selected without a stored endpoint'
      )
    );
  }

  return {
    _tag: 'Browser',
    endpoint: setting.browserEndpoint.value,
  } satisfies ActiveFetcher;
});
