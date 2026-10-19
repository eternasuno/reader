import { expect, it } from '@effect/vitest';
import { FeedParser } from '@reader/business';
import { Effect } from 'effect';
import { FeedParserLive } from '../../src/adapter/feed-parser';

it.effect(
  'exposes parsing through a service and converts failures to typed errors',
  () =>
    Effect.gen(function* () {
      const parser = yield* FeedParser;
      expect(
        (yield* Effect.flip(parser.parse('<html/>', 'https://example.com')))
          ._tag
      ).toBe('FeedParseError');
      expect(
        (yield* parser.parse(
          '<rss><channel><title>News</title></channel></rss>',
          'https://example.com'
        )).title
      ).toBe('News');
    }).pipe(Effect.provide(FeedParserLive))
);
