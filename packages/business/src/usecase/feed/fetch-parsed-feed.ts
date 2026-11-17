import { Effect } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';
import type { NormalizedUrl } from '../../entity/common/normalized-url';
import type { ParsedFeed } from '../../entity/feed/feed';
import { type FeedParserError, FetchFeedError } from '../../error/feed';
import { FeedParser } from '../../port/feed-parser';

/** Sent so that a source with content negotiation answers with its feed. */
const ACCEPT_HEADER =
  'application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8';

const FAILURE_MESSAGE = 'Failed to fetch the feed';

const decodeCredential = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * `fetch` rejects an address that carries a user name or password, so the
 * credentials of CM-URL-4 are sent as a Basic authorization header and the
 * address without them.
 */
const requestFor = (
  url: NormalizedUrl
): Effect.Effect<HttpClientRequest.HttpClientRequest, FetchFeedError> =>
  Effect.try({
    try: () => {
      const target = new URL(url.href);
      const username = decodeCredential(target.username);
      const password = decodeCredential(target.password);

      target.username = '';
      target.password = '';

      const request = HttpClientRequest.get(target, {
        headers: { accept: ACCEPT_HEADER },
      });

      if (username === '' && password === '') {
        return request;
      }

      return HttpClientRequest.basicAuth(request, username, password);
    },
    catch: () => new FetchFeedError({ message: FAILURE_MESSAGE }),
  });

/**
 * Fetches one source and parses it (FD-FETCH). It has no side effects and
 * reads no stored data (FD-FETCH-3); preview and refresh are its only callers.
 * Entry URLs are resolved against the final URL of the response, the URL of the
 * last hop, while the feed keeps the submitted URL (FD-FETCH-4).\n */
export const fetchParsedFeed = Effect.fn('fetchParsedFeed')(function* (
  url: NormalizedUrl
): Effect.fn.Return<
  ParsedFeed,
  FetchFeedError | FeedParserError,
  HttpClient.HttpClient | FeedParser
> {
  const client = yield* HttpClient.HttpClient;
  const parser = yield* FeedParser;
  const request = yield* requestFor(url);
  const response = yield* client.execute(request).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.mapError(() => new FetchFeedError({ message: FAILURE_MESSAGE }))
  );
  const text = yield* response.text.pipe(
    Effect.mapError(() => new FetchFeedError({ message: FAILURE_MESSAGE }))
  );

  return yield* parser.parse(text, new URL(response.url));
});
