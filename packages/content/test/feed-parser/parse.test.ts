import { expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { expectLink, parseFeed } from '../support/feed-parser';
import { jsonFeed, rss } from '../support/fixtures';

it.effect(
  'FD-PARSE-1 removes one leading byte-order mark and nothing else',
  () =>
    Effect.gen(function* () {
      const marked = yield* parseFeed(`\uFEFF${jsonFeed}`);
      expect(marked.title).toBe('JSON News');

      const error = yield* Effect.flip(parseFeed(`\uFEFF\uFEFF${jsonFeed}`));
      expect(error._tag).toBe('FeedParserError');
    })
);

it.effect(
  'FD-PARSE-1 fails a document that is not one of the four formats',
  () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        parseFeed('<html><body><p>Not a feed</p></body></html>')
      );

      expect(error).toMatchObject({
        _tag: 'FeedParserError',
        message: 'Unable to parse the feed document',
      });
    })
);

it.effect(
  'FD-PARSE-2 FD-PARSE-9 keeps the source order and does not collapse equal urls',
  () =>
    Effect.gen(function* () {
      const feed = yield* parseFeed(rss);

      expect(feed.entries.map((entry) => entry.title)).toEqual([
        'First',
        'Relative',
        'Again',
      ]);
      expectLink(feed.entries[2], 'https://example.com/a');
    })
);
