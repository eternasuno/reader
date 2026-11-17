import { expect, it } from '@effect/vitest';
import { JinaKey, WebpageFetcher } from '@reader/business';
import { Effect, Layer, Option, Schema } from 'effect';
import {
  HttpClientError as ClientError,
  Headers,
  HttpClient,
  type HttpClientRequest,
  HttpClientResponse,
} from 'effect/http';
import { JinaWebpageFetcherLive } from '../src/jina';

const article = 'https://example.com/article';

const html = '<html><body><p>Body</p></body></html>';

const secret = 'sk-secret';

const key = Option.some(Schema.decodeSync(JinaKey)(secret));

type Respond = (
  request: HttpClientRequest.HttpClientRequest
) => Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  ClientError.HttpClientError
>;

const stub = (respond: Respond): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => respond(request))
  );

const fetchPage = (
  storedKey: Option.Option<JinaKey>,
  respond: Respond,
  url = article
) =>
  Effect.flatMap(WebpageFetcher, (fetcher) => fetcher.fetch(url)).pipe(
    Effect.provide(
      Layer.provide(JinaWebpageFetcherLive(storedKey), stub(respond))
    )
  );

const answer =
  (body: string, status = 200): Respond =>
  (request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(body, { status }))
    );

const header = (
  request: HttpClientRequest.HttpClientRequest | undefined,
  name: string
): string | undefined =>
  request
    ? Option.getOrUndefined(Headers.get(request.headers, name))
    : undefined;

it.effect('CM-FETCH-3 asks Jina for the page html with the stored key', () =>
  Effect.gen(function* () {
    let seen: HttpClientRequest.HttpClientRequest | undefined;
    const result = yield* fetchPage(key, (request) => {
      seen = request;

      return answer(html)(request);
    });

    expect(result).toBe(html);
    expect(seen?.url).toBe(`https://r.jina.ai/${article}`);
    expect(header(seen, 'authorization')).toBe(`Bearer ${secret}`);
    expect(header(seen, 'accept')).toBe('text/html');
    expect(header(seen, 'x-return-format')).toBe('html');
  })
);

it.effect('SET-ACTIVE-1 asks Jina anonymously without a stored key', () =>
  Effect.gen(function* () {
    let seen: HttpClientRequest.HttpClientRequest | undefined;
    const result = yield* fetchPage(Option.none(), (request) => {
      seen = request;

      return answer(html)(request);
    });

    expect(result).toBe(html);
    expect(seen?.url).toBe(`https://r.jina.ai/${article}`);
    expect(header(seen, 'authorization')).toBeUndefined();
  })
);

it.effect('CM-URL-4 passes a URL that carries credentials on unchanged', () =>
  Effect.gen(function* () {
    let seen: HttpClientRequest.HttpClientRequest | undefined;
    const target = 'https://user:password@example.com/private';
    const result = yield* fetchPage(
      Option.none(),
      (request) => {
        seen = request;

        return answer(html)(request);
      },
      target
    );

    expect(result).toBe(html);
    expect(seen?.url).toBe(`https://r.jina.ai/${target}`);
  })
);

it.effect('CM-FETCH-4 reports a non-2xx answer without the key', () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      fetchPage(key, (request) => answer('denied', 403)(request))
    );

    expect(failure._tag).toBe('WebpageFetcherError');
    expect(failure.message).toBe('Jina request failed with status 403');
    expect(failure.message).not.toContain(secret);
  })
);

it.effect('CM-FETCH-4 reports a transport failure without the key', () =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(
      fetchPage(key, (request) =>
        Effect.fail(
          new ClientError.HttpClientError({
            reason: new ClientError.TransportError({
              request,
              cause: new Error(`socket hang up for ${secret}`),
            }),
          })
        )
      )
    );

    expect(failure._tag).toBe('WebpageFetcherError');
    expect(failure.message).toBe('Jina request failed');
    expect(failure.message).not.toContain(secret);
  })
);
