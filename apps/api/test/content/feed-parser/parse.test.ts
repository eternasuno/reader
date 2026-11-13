import { expect, it } from '@effect/vitest';
import { FeedParser } from '@reader/business';
import { Effect } from 'effect';
import { FeedParserLive, parseFeed } from '../../../src/content/feed-parser';
import {
  base,
  expectDescription,
  expectLink,
  rss,
} from '../../support/feed-parser';

it.effect('parses feed content through the FeedParser service', () =>
  Effect.gen(function* () {
    const parser = yield* FeedParser;
    const feed = yield* parser.parse(rss, base);
    expect(feed.title).toBe('News');
    expectLink(feed.entries[0], 'https://example.com/a');
  }).pipe(Effect.provide(FeedParserLive))
);

it.effect('FD-PARSE-1 reports unparseable content as a FeedParserError', () =>
  Effect.gen(function* () {
    const parser = yield* FeedParser;
    const error = yield* Effect.flip(parser.parse('<html></html>', base));
    expect(error).toMatchObject({
      _tag: 'FeedParserError',
      message: 'Failed to parse the subscription feed',
    });
  }).pipe(Effect.provide(FeedParserLive))
);

it('FD-PARSE-9 FD-PARSE-2 normalizes article URLs and metadata before returning parsed entries', () => {
  const feed = parseFeed(
    `<rss version="2.0"><channel><title>News</title><item>
    <title>  </title><link>/story?UTM_Source=tracker&amp;keep=1</link>
    <description>  Summary  </description>
  </item></channel></rss>`,
    base
  );
  const [entry] = feed.entries;
  expect(entry?.title).toBe('Untitled');
  expectLink(entry, 'https://example.com/story?keep=1');
  expectDescription(entry, 'Summary');
});
