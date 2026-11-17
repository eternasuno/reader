import {
  type JinaKey,
  WebpageFetcher,
  WebpageFetcherError,
} from '@reader/business';
import { Effect, Layer, Option, Redacted } from 'effect';
import { HttpClient } from 'effect/http';

const JINA_ENDPOINT = 'https://r.jina.ai/';

const failure = (message: string): WebpageFetcherError =>
  new WebpageFetcherError({ message });

/**
 * The key is sent as a bearer token only when one is stored; without it Jina
 * answers anonymously (SET-FETCH). The key never appears in a message.
 */
const headers = (key: Option.Option<JinaKey>): Record<string, string> => ({
  Accept: 'text/html',
  'X-Return-Format': 'html',
  ...Option.match(key, {
    onNone: () => ({}),
    onSome: (value) => ({ Authorization: `Bearer ${Redacted.value(value)}` }),
  }),
});

const readPage = (
  client: HttpClient.HttpClient,
  url: string,
  key: Option.Option<JinaKey>
): Effect.Effect<string, WebpageFetcherError> =>
  Effect.gen(function* () {
    // The target URL is passed whole: credentials in it are the site's, not
    // ours, and Jina fetches the page with them (CM-URL-4).
    const response = yield* client
      .get(`${JINA_ENDPOINT}${url}`, { headers: headers(key) })
      .pipe(Effect.mapError(() => failure('Jina request failed')));

    if (response.status < 200 || response.status >= 300) {
      return yield* failure(
        `Jina request failed with status ${response.status}`
      );
    }

    return yield* response.text.pipe(
      Effect.mapError(() => failure('Jina response read failed'))
    );
  });

/**
 * The Jina fetcher for the owner's stored key, none for anonymous access
 * (SET-ACTIVE-1). It sends its requests through the `HttpClient` of the
 * environment, so the server decides how they reach the network.
 */
export const JinaWebpageFetcherLive = (
  key: Option.Option<JinaKey>
): Layer.Layer<WebpageFetcher, never, HttpClient.HttpClient> =>
  Layer.effect(
    WebpageFetcher,
    Effect.map(HttpClient.HttpClient, (client) => ({
      fetch: (url: string) => readPage(client, url, key),
    }))
  );
