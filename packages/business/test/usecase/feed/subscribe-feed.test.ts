import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { FeedTitle } from '../../../src/entity/feed/feed';
import { FeedRepository } from '../../../src/port/feed-repository';
import { FolderRepository } from '../../../src/port/folder-repository';
import { subscribeFeed } from '../../../src/usecase/feed/subscribe-feed';
import {
  alice,
  bob,
  decodeUrl,
  makeUniqueFeed,
  makeUniqueFolder,
} from '../../support/fixtures';
import { run } from './support';

const url = decodeUrl('https://example.com/feed.xml');

const title = FeedTitle.make('Previewed title');

describe('subscribeFeed', () => {
  it.effect(
    'FD-SUB creates the feed with a new id, the previewed title and no sync time',
    () =>
      Effect.gen(function* () {
        const stored = yield* run(
          Effect.gen(function* () {
            const feed = yield* subscribeFeed(alice, url, title, Option.none());
            const feeds = yield* FeedRepository;

            return { feed, listed: yield* feeds.list(alice) };
          })
        );

        expect(stored.listed).toHaveLength(1);
        expect(stored.listed[0]?.id).toBe(stored.feed.id);
        expect(stored.feed.ownerId).toBe(alice);
        expect(stored.feed.url.href).toBe('https://example.com/feed.xml');
        expect(stored.feed.title).toBe('Previewed title');
        expect(Option.isNone(stored.feed.folderId)).toBe(true);
        expect(Option.isNone(stored.feed.updatedAt)).toBe(true);
      })
  );
});

describe('subscribeFeed into a folder', () => {
  it.effect('FD-SUB-6 creates the feed in the folder it was given', () =>
    Effect.gen(function* () {
      const stored = yield* run(
        Effect.gen(function* () {
          const folders = yield* FolderRepository;
          const folder = makeUniqueFolder({ ownerId: alice });

          yield* folders.create(alice, [folder]);

          const feed = yield* subscribeFeed(
            alice,
            url,
            title,
            Option.some(folder.id)
          );

          return { folder, feed };
        })
      );

      expect(Option.getOrThrow(stored.feed.folderId)).toBe(stored.folder.id);
    })
  );
});

describe('subscribeFeed folder failures', () => {
  it.effect(
    'FD-SUB-6 fails FolderNotFound for a folder of another owner and creates nothing',
    () =>
      Effect.gen(function* () {
        const foreign = makeUniqueFolder({ ownerId: bob });

        const outcome = yield* run(
          Effect.gen(function* () {
            const folders = yield* FolderRepository;
            const feeds = yield* FeedRepository;

            yield* folders.create(bob, [foreign]);

            const error = yield* subscribeFeed(
              alice,
              url,
              title,
              Option.some(foreign.id)
            ).pipe(Effect.flip);

            return { error, feeds: yield* feeds.list(alice) };
          })
        );

        expect(outcome.error._tag).toBe('FolderNotFound');
        expect(outcome.feeds).toEqual([]);
      })
  );
});

describe('subscribeFeed duplicates', () => {
  it.effect(
    'FD-SUB-1 a URL the owner already follows fails FeedAlreadyExists with that URL',
    () =>
      Effect.gen(function* () {
        const existing = makeUniqueFeed({
          ownerId: alice,
          url,
          title: FeedTitle.make('Existing'),
        });

        const outcome = yield* run(
          Effect.gen(function* () {
            const feeds = yield* FeedRepository;

            yield* feeds.create(alice, [existing]);

            const error = yield* subscribeFeed(
              alice,
              url,
              title,
              Option.none()
            ).pipe(Effect.flip);

            return { error, feeds: yield* feeds.list(alice) };
          })
        );

        expect(outcome.error._tag).toBe('FeedAlreadyExists');
        expect(outcome.error).toMatchObject({
          url: { href: 'https://example.com/feed.xml' },
        });
        expect(outcome.feeds.map((feed) => feed.id)).toEqual([existing.id]);
      })
  );
});

describe('subscribeFeed duplicate keeps the folder', () => {
  it.effect('FD-SUB-7 a duplicate leaves the existing feed in its folder', () =>
    Effect.gen(function* () {
      const outcome = yield* run(
        Effect.gen(function* () {
          const folders = yield* FolderRepository;
          const feeds = yield* FeedRepository;
          const home = makeUniqueFolder({ ownerId: alice });
          const other = makeUniqueFolder({ ownerId: alice });

          yield* folders.create(alice, [home, other]);

          const existing = makeUniqueFeed({
            ownerId: alice,
            url,
            folderId: Option.some(home.id),
          });

          yield* feeds.create(alice, [existing]);

          const error = yield* subscribeFeed(
            alice,
            url,
            title,
            Option.some(other.id)
          ).pipe(Effect.flip);
          const found = yield* feeds.find(alice, existing.id);

          return {
            error,
            home: home.id,
            kept: Option.getOrThrow(
              Option.flatMap(found, (feed) => feed.folderId)
            ),
          };
        })
      );

      expect(outcome.error._tag).toBe('FeedAlreadyExists');
      expect(outcome.kept).toBe(outcome.home);
    })
  );
});

describe('subscribeFeed owners', () => {
  it.effect('FD-ID-1 two owners subscribing to one URL get two feeds', () =>
    Effect.gen(function* () {
      const feeds = yield* run(
        Effect.gen(function* () {
          const mine = yield* subscribeFeed(alice, url, title, Option.none());
          const theirs = yield* subscribeFeed(bob, url, title, Option.none());

          return { mine, theirs };
        })
      );

      expect(feeds.mine.id).not.toBe(feeds.theirs.id);
      expect(feeds.theirs.ownerId).toBe(bob);
    })
  );
});
