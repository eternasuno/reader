import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { Headers } from 'effect/http';
import { FeedParserError } from '../../../src/error/feed';
import { fetchParsedFeed } from '../../../src/usecase/feed/fetch-parsed-feed';
import { decodeUrl } from '../../support/fixtures';
import { feedResponse, parsedFeed, run, transportFailure } from './support';

const url = decodeUrl('https://example.com/feed.xml');

describe('fetchParsedFeed', () => {
  it.effect('FD-FETCH-1 returns the feed the parser read', () =>
    Effect.gen(function* () {
      const parsed = yield* run(fetchParsedFeed(url), {
        parseFeed: () => Effect.succeed(parsedFeed({ title: 'Source' })),
      });

      expect(parsed.title).toBe('Source');
    })
  );

  it.effect('FD-FETCH-4 sends a GET to the submitted address', () =>
    Effect.gen(function* () {
      const targets: Array<string> = [];

      yield* run(fetchParsedFeed(url), {
        fetchFeed: (target) => {
          targets.push(target.href);

          return Effect.succeed(feedResponse({ url: target.href }));
        },
      });

      expect(targets).toEqual(['https://example.com/feed.xml']);
    })
  );
});

describe('fetchParsedFeed redirects', () => {
  it.effect(
    'FD-FETCH-4 parses the body against the final URL of the response',
    () =>
      Effect.gen(function* () {
        const bases: Array<string> = [];
        const bodies: Array<string> = [];

        yield* run(fetchParsedFeed(url), {
          fetchFeed: () =>
            Effect.succeed(
              feedResponse({
                url: 'https://example.com/final/feed.xml',
                body: '<rss>body</rss>',
              })
            ),
          parseFeed: (text, baseUrl) => {
            bodies.push(text);
            bases.push(baseUrl.href);

            return Effect.succeed(parsedFeed());
          },
        });

        expect(bodies).toEqual(['<rss>body</rss>']);
        expect(bases).toEqual(['https://example.com/final/feed.xml']);
      })
  );
});

describe('fetchParsedFeed failures', () => {
  it.effect('FD-FETCH-2 a response that is not 2xx fails FetchFeedError', () =>
    Effect.gen(function* () {
      const error = yield* run(fetchParsedFeed(url), {
        fetchFeed: (target) =>
          Effect.succeed(feedResponse({ url: target.href, status: 500 })),
      }).pipe(Effect.flip);

      expect(error._tag).toBe('FetchFeedError');
    })
  );

  it.effect('FD-FETCH-2 a failed fetch fails FetchFeedError', () =>
    Effect.gen(function* () {
      const error = yield* run(fetchParsedFeed(url), {
        fetchFeed: (target) => Effect.fail(transportFailure(target)),
      }).pipe(Effect.flip);

      expect(error._tag).toBe('FetchFeedError');
    })
  );
});

const captureAuth = Effect.fnUntraced(function* (href: string) {
  const seen: Array<{ target: string; auth: string | undefined }> = [];

  yield* run(fetchParsedFeed(decodeUrl(href)), {
    fetchFeed: (target, request) => {
      seen.push({
        target: target.href,
        auth: Option.getOrUndefined(
          Headers.get(request.headers, 'authorization')
        ),
      });

      return Effect.succeed(feedResponse({ url: target.href }));
    },
  });

  return seen;
});

describe('fetchParsedFeed credentials', () => {
  it.effect(
    'CM-URL-4 sends credentials as Basic authorization and leaves them out of the address',
    () =>
      Effect.gen(function* () {
        const seen = yield* captureAuth(
          'https://user:secret@example.com/feed.xml'
        );

        expect(seen).toEqual([
          {
            target: 'https://example.com/feed.xml',
            auth: `Basic ${btoa('user:secret')}`,
          },
        ]);
      })
  );

  it.effect(
    'CM-URL-4 decodes UTF-8 escaped credentials and keeps malformed percent sequences raw',
    () =>
      Effect.gen(function* () {
        const raw = yield* captureAuth(
          'https://user%:%FF@example.com/feed.xml'
        );
        const utf8 = yield* captureAuth(
          'https://user:p%C3%A4ss%E5%AF%86@example.com/feed.xml'
        );

        expect(raw).toEqual([
          {
            target: 'https://example.com/feed.xml',
            auth: `Basic ${btoa('user%:%FF')}`,
          },
        ]);
        expect(utf8).toEqual([
          {
            target: 'https://example.com/feed.xml',
            auth: `Basic ${Buffer.from('user:päss密', 'utf8').toString('base64')}`,
          },
        ]);
      })
  );
});

describe('fetchParsedFeed parsing', () => {
  it.effect(
    'FD-FETCH-2 a source that cannot be parsed fails FeedParserError',
    () =>
      Effect.gen(function* () {
        const error = yield* run(fetchParsedFeed(url), {
          parseFeed: () =>
            Effect.fail(new FeedParserError({ message: 'not a feed' })),
        }).pipe(Effect.flip);

        expect(error._tag).toBe('FeedParserError');
      })
  );
});
