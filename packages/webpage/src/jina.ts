import { Effect, Redacted } from 'effect';
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientResponse,
} from 'effect/http';
import { FetchFailure } from './failure';

const JINA_ENDPOINT = 'https://r.jina.ai/';

const requestPage = (
  url: string,
  key: Redacted.Redacted<string> | undefined
): Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  FetchFailure,
  HttpClient.HttpClient
> =>
  HttpClient.get(`${JINA_ENDPOINT}${url}`, {
    headers: {
      Accept: 'text/html',
      ...(key ? { Authorization: `Bearer ${Redacted.value(key)}` } : {}),
      'X-Return-Format': 'html',
    },
  }).pipe(
    Effect.mapError(
      (cause) => new FetchFailure({ message: 'Jina request failed', cause })
    )
  );

export const fetchJina = (
  url: string,
  key: Redacted.Redacted<string> | undefined
): Effect.Effect<string, FetchFailure> =>
  Effect.gen(function* () {
    const response = yield* requestPage(url, key);

    if (response.status < 200 || response.status >= 300) {
      return yield* new FetchFailure({
        message: `Jina request failed with status ${response.status}`,
      });
    }

    return yield* response.text.pipe(
      Effect.mapError(
        (cause) =>
          new FetchFailure({ message: 'Jina response read failed', cause })
      )
    );
  }).pipe(Effect.provide(FetchHttpClient.layer));
