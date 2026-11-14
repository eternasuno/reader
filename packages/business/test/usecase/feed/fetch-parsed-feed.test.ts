import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { Headers } from 'effect/http';
import { FeedParserError } from '../../../src/port/feed-parser';
import { fetchParsedFeed } from '../../../src/usecase/feed/fetch-parsed-feed';
import { decodeUrl } from '../../support/fixtures';
import {
  feedResponse,
  parsedEntry,
  parsedFeed,
  run,
  transportFailure,
} from '../../support/usecase/feed';

const url = decodeUrl('https://example.com/feed.xml');

const finalUrl = 'https://cdn.example.com/final.xml';

describe('fetchParsedFeed credentials', () => {
  it.effect('sends URL credentials as basic auth without userinfo', () =>
    Effect.gen(function* () {
      const credentialUrl = decodeUrl(
        'https://us%40er:pa%3Ass@example.com/feed.xml'
      );
      const requests: Array<{
        readonly href: string;
        readonly authorization: Option.Option<string>;
      }> = [];

      yield* run(fetchParsedFeed(credentialUrl), {
        fetchFeed: (target, request) => {
          requests.push({
            href: target.href,
            authorization: Headers.get(request.headers, 'authorization'),
          });

          return Effect.succeed(feedResponse({ url: target.href }));
        },
      });

      const requested = requests[0];

      expect(requested?.href).toBe('https://example.com/feed.xml');

      const authorization = Option.getOrThrow(
        requested?.authorization ?? Option.none()
      );

      expect(authorization.startsWith('Basic ')).toBe(true);
      expect(
        Buffer.from(authorization.slice('Basic '.length), 'base64').toString(
          'utf8'
        )
      ).toBe('us@er:pa:ss');
    })
  );
});

describe('fetchParsedFeed', () => {
  it.effect('parses the body against the final URL of the response', () =>
    Effect.gen(function* () {
      const requested: Array<string> = [];
      const parsed: Array<readonly [string, string]> = [];
      const feed = parsedFeed({
        entries: [parsedEntry('https://cdn.example.com/entry')],
      });

      const result = yield* run(fetchParsedFeed(url), {
        fetchFeed: (target) => {
          requested.push(target.href);

          return Effect.succeed(
            feedResponse({ url: finalUrl, body: '<rss>body</rss>' })
          );
        },
        parseFeed: (text, baseUrl) => {
          parsed.push([text, baseUrl.href]);

          return Effect.succeed(feed);
        },
      });

      expect(result).toEqual(feed);
      expect(requested).toEqual([url.href]);
      expect(parsed).toEqual([['<rss>body</rss>', finalUrl]]);
    })
  );

  it.effect('reports a non-2xx response as a fetch failure', () =>
    Effect.gen(function* () {
      const error = yield* run(fetchParsedFeed(url), {
        fetchFeed: () => Effect.succeed(feedResponse({ status: 404 })),
      }).pipe(Effect.flip);

      expect(error._tag).toBe('FetchFeedError');
      expect(error.message).toBe('Failed to fetch the feed');
    })
  );

  it.effect('reports a transport failure as a fetch failure', () =>
    Effect.gen(function* () {
      const error = yield* run(fetchParsedFeed(url), {
        fetchFeed: (target) => Effect.fail(transportFailure(target)),
      }).pipe(Effect.flip);

      expect(error._tag).toBe('FetchFeedError');
      expect(error.message).toBe('Failed to fetch the feed');
    })
  );

  it.effect('propagates the parser error', () =>
    Effect.gen(function* () {
      const error = yield* run(fetchParsedFeed(url), {
        parseFeed: () => Effect.fail(new FeedParserError({ message: 'parse' })),
      }).pipe(Effect.flip);

      expect(error._tag).toBe('FeedParserError');
      expect(error.message).toBe('parse');
    })
  );
});
