import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { previewFeed } from '../../../src/usecase/feed/preview-feed';
import { alice, decodeUrl } from '../../support/fixtures';
import {
  allItems,
  parsedEntry,
  parsedFeed,
  run,
  storedFeeds,
  transportFailure,
} from '../../support/usecase/feed';

const url = decodeUrl('https://example.com/feed.xml');

const feed = parsedFeed({
  title: 'Source title',
  description: Option.some('Source description'),
  entries: [
    parsedEntry('https://example.com/a', { title: 'First' }),
    parsedEntry('https://example.com/b', { title: 'Second' }),
  ],
});

describe('previewFeed', () => {
  it.effect('returns the feed title, description and entry titles', () =>
    Effect.gen(function* () {
      const preview = yield* run(previewFeed(url), {
        parseFeed: () => Effect.succeed(feed),
      });

      expect(preview.title).toBe('Source title');
      expect(Option.getOrThrow(preview.description)).toBe('Source description');
      expect(preview.entryTitles).toEqual(['First', 'Second']);
    })
  );

  it.effect('keeps a missing description as none', () =>
    Effect.gen(function* () {
      const preview = yield* run(previewFeed(url), {
        parseFeed: () => Effect.succeed(parsedFeed({ entries: [] })),
      });

      expect(Option.isNone(preview.description)).toBe(true);
      expect(preview.entryTitles).toEqual([]);
    })
  );

  it.effect('stores no feed and no item', () =>
    Effect.gen(function* () {
      const state = yield* run(
        Effect.gen(function* () {
          yield* previewFeed(url);

          return {
            feeds: yield* storedFeeds(alice),
            items: yield* allItems(alice),
          };
        }),
        { parseFeed: () => Effect.succeed(feed) }
      );

      expect(state.feeds).toEqual([]);
      expect(state.items).toEqual([]);
    })
  );

  it.effect('fails as fetch and parse do', () =>
    Effect.gen(function* () {
      const error = yield* run(previewFeed(url), {
        fetchFeed: (target) => Effect.fail(transportFailure(target)),
      }).pipe(Effect.flip);

      expect(error._tag).toBe('FetchFeedError');
    })
  );
});
