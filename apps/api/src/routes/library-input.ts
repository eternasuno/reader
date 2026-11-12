import {
  BrowserEndpoint,
  type FetcherInput,
  JinaKey,
  NormalizedUrl,
  Retention,
} from '@reader/business';
import { Effect, Schema } from 'effect';
import {
  feedUrlInvalid,
  invalidEndpoint,
  invalidKey,
  invalidPageUrl,
  invalidProvider,
  invalidRetention,
} from './library-errors';

export const decodePageUrl = (
  text: string
): Effect.Effect<NormalizedUrl, ReturnType<typeof invalidPageUrl>> =>
  Schema.decodeEffect(NormalizedUrl)(text).pipe(
    Effect.mapError(() => invalidPageUrl())
  );

export const decodeFeedUrl = (
  text: string
): Effect.Effect<NormalizedUrl, ReturnType<typeof feedUrlInvalid>> =>
  Schema.decodeEffect(NormalizedUrl)(text).pipe(
    Effect.mapError(() => feedUrlInvalid())
  );

export const decodeRetention = (
  value: number
): Effect.Effect<Retention, ReturnType<typeof invalidRetention>> =>
  Schema.decodeEffect(Retention)(value).pipe(
    Effect.mapError(() => invalidRetention())
  );

const givenText = (text: string | undefined) => {
  const trimmed = text?.trim() ?? '';

  return trimmed === '' ? undefined : text;
};

const decodeJinaKey = (
  text: string | undefined
): Effect.Effect<JinaKey | undefined, ReturnType<typeof invalidKey>> => {
  const given = givenText(text);

  return given === undefined
    ? Effect.undefined
    : Schema.decodeEffect(JinaKey)(given).pipe(
        Effect.mapError(() => invalidKey())
      );
};

const decodeBrowserEndpoint = (
  text: string | undefined
): Effect.Effect<
  BrowserEndpoint | undefined,
  ReturnType<typeof invalidEndpoint>
> => {
  const given = givenText(text);

  return given === undefined
    ? Effect.undefined
    : Schema.decodeEffect(BrowserEndpoint)(given).pipe(
        Effect.mapError(() => invalidEndpoint())
      );
};

export const decodeFetcherInput = (payload: {
  readonly provider: string;
  readonly key?: string;
  readonly endpoint?: string;
}): Effect.Effect<
  FetcherInput,
  | ReturnType<typeof invalidProvider>
  | ReturnType<typeof invalidKey>
  | ReturnType<typeof invalidEndpoint>
> =>
  Effect.gen(function* () {
    const { provider } = payload;

    if (provider !== 'jina' && provider !== 'browser') {
      return yield* Effect.fail(invalidProvider());
    }

    if (provider === 'jina') {
      const key = yield* decodeJinaKey(payload.key);

      return key === undefined ? { provider } : { provider, key };
    }

    const endpoint = yield* decodeBrowserEndpoint(payload.endpoint);

    return endpoint === undefined ? { provider } : { provider, endpoint };
  });
