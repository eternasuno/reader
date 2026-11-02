import { Effect, Stream } from 'effect';
import { HttpClient, type HttpClientResponse } from 'effect/http';
import { FetchSubscriptionError } from './subscription-errors';

export type FeedDocument = {
  readonly content: string;
  readonly url: URL;
};

const MAX_REDIRECTS = 3;

const MAX_BYTES = 2 * 1024 * 1024;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const FEED_HEADERS = {
  accept:
    'application/rss+xml, application/atom+xml, application/xml, text/xml',
  'accept-encoding': 'identity',
  'user-agent': 'ReadLater/1.0',
};

const fetchFailure = () =>
  new FetchSubscriptionError({
    message: 'Failed to fetch the subscription feed',
  });

const readBody = (
  response: HttpClientResponse.HttpClientResponse
): Effect.Effect<string, FetchSubscriptionError> =>
  Stream.runFoldEffect(
    response.stream,
    () => ({ chunks: [] as Uint8Array[], size: 0 }),
    (state, chunk) => {
      const size = state.size + chunk.length;

      if (size > MAX_BYTES) {
        return Effect.fail(fetchFailure());
      }

      state.chunks.push(chunk);

      return Effect.succeed({ chunks: state.chunks, size });
    }
  ).pipe(
    Effect.map((state) => Buffer.concat(state.chunks).toString('utf8')),
    Effect.mapError(() => fetchFailure())
  );

const redirectTarget = (
  response: HttpClientResponse.HttpClientResponse,
  current: URL
): Effect.Effect<URL, FetchSubscriptionError> => {
  const { location } = response.headers;

  if (!location) {
    return Effect.fail(fetchFailure());
  }

  return Effect.try({
    try: () => new URL(location, current),
    catch: () => fetchFailure(),
  });
};

type Hop =
  | { readonly _tag: 'redirect'; readonly url: URL }
  | { readonly _tag: 'document'; readonly document: FeedDocument };

const hopFrom = (
  response: HttpClientResponse.HttpClientResponse,
  url: URL,
  redirects: number
): Effect.Effect<Hop, FetchSubscriptionError> => {
  if (REDIRECT_STATUSES.has(response.status)) {
    if (redirects >= MAX_REDIRECTS) {
      return Effect.fail(fetchFailure());
    }

    return Effect.map(redirectTarget(response, url), (target) => ({
      _tag: 'redirect',
      url: target,
    }));
  }

  const encoding = response.headers['content-encoding'];
  if (response.status !== 200 || (encoding && encoding !== 'identity')) {
    return Effect.fail(fetchFailure());
  }

  return Effect.map(readBody(response), (content) => ({
    _tag: 'document',
    document: { content, url },
  }));
};

const sendHop = (
  client: HttpClient.HttpClient,
  url: URL,
  redirects: number
): Effect.Effect<Hop, FetchSubscriptionError> =>
  Effect.scoped(
    Effect.gen(function* () {
      const response = yield* HttpClient.withScope(client)
        .get(url, { headers: FEED_HEADERS })
        .pipe(Effect.mapError(() => fetchFailure()));

      return yield* hopFrom(response, url, redirects);
    })
  );

const follow = (
  client: HttpClient.HttpClient,
  url: URL,
  redirects: number
): Effect.Effect<FeedDocument, FetchSubscriptionError> =>
  Effect.flatMap(sendHop(client, url, redirects), (hop) =>
    hop._tag === 'redirect'
      ? follow(client, hop.url, redirects + 1)
      : Effect.succeed(hop.document)
  );

export const fetchFeed = (
  url: URL
): Effect.Effect<FeedDocument, FetchSubscriptionError, HttpClient.HttpClient> =>
  Effect.flatMap(HttpClient.HttpClient, (client) => follow(client, url, 0));
