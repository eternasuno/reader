import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedItemRepository } from '../../../src/port/feed-item-repository';
import { FeedRepository } from '../../../src/port/feed-repository';
import { previewFeed } from '../../../src/usecase/feed/preview-feed';
import { alice, decodeUrl } from '../../support/fixtures';
import { parsedEntry, parsedFeed, run, transportFailure } from './support';

const url = decodeUrl('https://example.com/feed.xml');

const source = parsedFeed({
  title: 'Source title',
  description: Option.some('Source description'),
  entries: [
    parsedEntry('https://example.com/a', { title: 'First' }),
    parsedEntry('https://example.com/b', { title: 'Second' }),
  ],
});

describe('previewFeed', () => {
  it.effect(
    'FD-PREVIEW-3 returns the feed title, its description and the entry titles in source order',
    () =>
      Effect.gen(function* () {
        const preview = yield* run(previewFeed(url), {
          parseFeed: () => Effect.succeed(source),
        });

        expect(preview.title).toBe('Source title');
        expect(Option.getOrThrow(preview.description)).toBe(
          'Source description'
        );
        expect(preview.entryTitles).toEqual(['First', 'Second']);
      })
  );

  it.effect(
    'FD-PREVIEW keeps a source description that is missing as none',
    () =>
      Effect.gen(function* () {
        const preview = yield* run(previewFeed(url), {
          parseFeed: () => Effect.succeed(parsedFeed()),
        });

        expect(Option.isNone(preview.description)).toBe(true);
        expect(preview.entryTitles).toEqual([]);
      })
  );
});

describe('previewFeed storage and failures', () => {
  it.effect('FD-PREVIEW-1 stores no subscription and no article', () =>
    Effect.gen(function* () {
      const state = yield* run(
        Effect.gen(function* () {
          yield* previewFeed(url);

          const feeds = yield* FeedRepository;
          const items = yield* FeedItemRepository;

          return {
            feeds: yield* feeds.list(alice),
            items: yield* items.listAll(alice, {
              limit: Number.MAX_SAFE_INTEGER,
              unread: false,
              cursor: Option.none(),
            }),
          };
        }),
        { parseFeed: () => Effect.succeed(source) }
      );

      expect(state.feeds).toEqual([]);
      expect(state.items).toEqual([]);
    })
  );

  it.effect('FD-PREVIEW-2 fails when the source cannot be fetched', () =>
    Effect.gen(function* () {
      const error = yield* run(previewFeed(url), {
        fetchFeed: (target) => Effect.fail(transportFailure(target)),
      }).pipe(Effect.flip);

      expect(error._tag).toBe('FetchFeedError');
    })
  );
});
