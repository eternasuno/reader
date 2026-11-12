import { Effect } from 'effect';
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/http';
import type { NormalizedUrl } from '../../entity/common/normalized-url';
import {
  FeedParser,
  type FeedParserError,
  type ParsedFeed,
} from '../../port/feed-parser';
import { FetchFeedError } from './errors';

const accept =
  'application/rss+xml, application/atom+xml, application/feed+json, application/json, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8';

const failureMessage = 'Failed to fetch the feed';

const requestFor = (
  url: NormalizedUrl
): HttpClientRequest.HttpClientRequest => {
  const target = new URL(url.href);
  const username = target.username;
  const password = target.password;

  target.username = '';
  target.password = '';

  const request = HttpClientRequest.get(target, { headers: { accept } });

  if (username === '' && password === '') {
    return request;
  }

  return HttpClientRequest.basicAuth(
    request,
    decodeURIComponent(username),
    decodeURIComponent(password)
  );
};

export const fetchParsedFeed = (
  url: NormalizedUrl
): Effect.Effect<
  ParsedFeed,
  FetchFeedError | FeedParserError,
  HttpClient.HttpClient | FeedParser
> =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const parser = yield* FeedParser;
    const response = yield* client.execute(requestFor(url)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.mapError(() => new FetchFeedError({ message: failureMessage }))
    );
    const text = yield* response.text.pipe(
      Effect.mapError(() => new FetchFeedError({ message: failureMessage }))
    );
    const finalUrl = new URL(response.url);

    return yield* parser.parse(text, finalUrl);
  });
