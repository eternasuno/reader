import { describe, expect, it } from '@effect/vitest';
import { Effect, Option, Ref } from 'effect';
import { FeedTitle } from '../../../src/entity/feed/feed';
import {
  FeedAlreadyExists,
  FolderNotFound,
} from '../../../src/usecase/feed/errors';
import { subscribeFeed } from '../../../src/usecase/feed/subscribe-feed';
import {
  alice,
  decodeUrl,
  makeFolder,
  storedFolder,
} from '../../support/fixtures';
import {
  feedResponse,
  findFeed,
  run,
  storedFeeds,
} from '../../support/usecase/feed';

const url = decodeUrl('https://example.com/feed.xml');

const title = FeedTitle.make('My feed');

describe('subscribeFeed', () => {
  it.effect('creates a feed with the given title and no updated time', () =>
    Effect.gen(function* () {
      const fetched = yield* Ref.make(0);
      const result = yield* run(
        Effect.gen(function* () {
          const created = yield* subscribeFeed(
            alice,
            url,
            title,
            Option.none()
          );

          return { created, feeds: yield* storedFeeds(alice) };
        }),
        {
          fetchFeed: (target) =>
            Ref.update(fetched, (count) => count + 1).pipe(
              Effect.as(feedResponse({ url: target.href }))
            ),
        }
      );

      expect(result.created.url.href).toBe(url.href);
      expect(result.created.ownerId).toBe(alice);
      expect(result.created.title).toBe('My feed');
      expect(Option.isNone(result.created.folderId)).toBe(true);
      expect(Option.isNone(result.created.updatedAt)).toBe(true);
      expect(result.feeds.map((feed) => feed.id)).toEqual([result.created.id]);
      expect(yield* Ref.get(fetched)).toBe(0);
    })
  );
});

describe('subscribeFeed duplicates', () => {
  it.effect('fails a duplicate without creating a second feed', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          yield* subscribeFeed(alice, url, title, Option.none());
          const error = yield* subscribeFeed(
            alice,
            url,
            FeedTitle.make('Another title'),
            Option.none()
          ).pipe(Effect.flip);

          return { error, feeds: yield* storedFeeds(alice) };
        })
      );

      expect(result.error).toStrictEqual(new FeedAlreadyExists({ url }));
      expect(result.feeds).toHaveLength(1);
    })
  );
});

describe('subscribeFeed folders', () => {
  it.effect('FD-SUB-6 creates the feed in the given folder', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const folder = yield* storedFolder(alice);
          const created = yield* subscribeFeed(
            alice,
            url,
            title,
            Option.some(folder.id)
          );

          return { created, feeds: yield* storedFeeds(alice) };
        })
      );

      const folderId = Option.getOrThrow(result.created.folderId);

      expect(result.feeds.map((feed) => feed.id)).toEqual([result.created.id]);
      expect(
        result.feeds.map((feed) => Option.getOrThrow(feed.folderId))
      ).toEqual([folderId]);
    })
  );

  it.effect('FD-SUB-6 fails an unknown folder and creates no feed', () =>
    Effect.gen(function* () {
      const unknown = makeFolder({ ownerId: alice }).id;
      const result = yield* run(
        Effect.gen(function* () {
          const error = yield* subscribeFeed(
            alice,
            url,
            title,
            Option.some(unknown)
          ).pipe(Effect.flip);

          return { error, feeds: yield* storedFeeds(alice) };
        })
      );

      expect(result.error).toStrictEqual(new FolderNotFound({ id: unknown }));
      expect(result.feeds).toHaveLength(0);
    })
  );
});

describe('subscribeFeed folders duplicates', () => {
  it.effect('FD-SUB-7 a duplicate with a folder keeps the folder none', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const folder = yield* storedFolder(alice);
          const first = yield* subscribeFeed(alice, url, title, Option.none());
          const error = yield* subscribeFeed(
            alice,
            url,
            title,
            Option.some(folder.id)
          ).pipe(Effect.flip);

          return { error, stored: yield* findFeed(alice, first.id) };
        })
      );
      const stored = Option.getOrThrow(result.stored);

      expect(result.error).toStrictEqual(new FeedAlreadyExists({ url }));
      expect(Option.isNone(stored.folderId)).toBe(true);
    })
  );
});

describe('subscribeFeed duplicates with a missing folder', () => {
  it.effect('FD-SUB-7 a missing folder takes precedence over a duplicate', () =>
    Effect.gen(function* () {
      const unknown = makeFolder({ ownerId: alice }).id;
      const result = yield* run(
        Effect.gen(function* () {
          const first = yield* subscribeFeed(alice, url, title, Option.none());
          const error = yield* subscribeFeed(
            alice,
            url,
            title,
            Option.some(unknown)
          ).pipe(Effect.flip);

          return { error, first, feeds: yield* storedFeeds(alice) };
        })
      );

      expect(result.error).toStrictEqual(new FolderNotFound({ id: unknown }));
      expect(result.feeds).toStrictEqual([result.first]);
    })
  );
});
