import type { FetchFeedError } from '@reader/business';
import { Effect } from 'effect';
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from 'effect/http';

const JINA_PREFIX = 'https://r.jina.ai/';

const ARTICLE_HTML = `<!doctype html>
<html>
  <head><title>Example article</title></head>
  <body>
    <article>
      <h1>Example article</h1>
      <p>An example article body long enough for the extractor to keep it as
      the article content of the saved page.</p>
    </article>
  </body>
</html>`;

export type WebpageResponse = string | Response;

export type WebpageStub = (
  url: string
) => WebpageResponse | Promise<WebpageResponse>;

type FeedResponse = {
  readonly content: string;
  readonly url: URL;
};

export type FeedStub = (
  url: URL
) => FeedResponse | Effect.Effect<FeedResponse, FetchFeedError>;

export const defaultArticle = () => ARTICLE_HTML;

const targetOf = (url: string) =>
  url.startsWith(JINA_PREFIX) ? url.slice(JINA_PREFIX.length) : url;

const asResponse = (value: WebpageResponse) =>
  typeof value === 'string' ? new Response(value, { status: 200 }) : value;

const requestTarget = (input: string | URL | Request) => {
  if (typeof input === 'string') {
    return input;
  }

  if (input instanceof URL) {
    return input.href;
  }

  return input.url;
};

export const webpageFetch = (stub: WebpageStub) =>
  (async (input: string | URL | Request) => {
    return asResponse(await stub(targetOf(requestTarget(input))));
  }) as typeof globalThis.fetch;

export const asEffect = <A, E>(
  value: A | Effect.Effect<A, E>
): Effect.Effect<A, E> =>
  Effect.isEffect(value) ? value : Effect.succeed(value);

export const feedClient = (stub: FeedStub): HttpClient.HttpClient =>
  HttpClient.make((request) =>
    asEffect(stub(new URL(request.url))).pipe(
      Effect.map((feed) =>
        HttpClientResponse.fromWeb(
          HttpClientRequest.setUrl(request, feed.url),
          new Response(feed.content, { status: 200 })
        )
      ),
      Effect.mapError(
        (cause) =>
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause }),
          })
      )
    )
  );
