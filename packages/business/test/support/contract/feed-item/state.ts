import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { ArticleContent } from '../../../../src/entity/common/article';
import type { FeedUnreadCount } from '../../../../src/port/feed-item-repository';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import { alice, bob, makeUniqueFeedItem, storedFeed } from '../../fixtures';
import type { FeedStoreLayer } from '../feed';

const unreadFor = (
  counts: ReadonlyArray<FeedUnreadCount>,
  feedId: string
): number => counts.find((count) => count.feedId === feedId)?.count ?? 0;

const markReadScopeCases = (layer: FeedStoreLayer) => (): void => {
  it.effect(
    'FD-READ-1 marks the owner items among the ids and ignores foreign and unknown ids',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const bobFeed = yield* storedFeed(bob);
        const mine = makeUniqueFeedItem({ feedId: feed.id });
        const foreign = makeUniqueFeedItem({
          feedId: bobFeed.id,
          ownerId: bob,
        });
        yield* items.create(alice, [mine]);
        yield* items.create(bob, [foreign]);

        yield* items.markRead(
          alice,
          [mine.id, foreign.id, mine.id, makeUniqueFeedItem().id],
          true
        );

        expect(Option.getOrThrow(yield* items.find(alice, mine.id)).read).toBe(
          true
        );
        expect(Option.getOrThrow(yield* items.find(bob, foreign.id)).read).toBe(
          false
        );
      }).pipe(Effect.provide(layer))
  );
};

const markReadRepeatCases = (layer: FeedStoreLayer) => (): void => {
  it.effect(
    'FD-READ-4 marking twice is idempotent and marking back clears read',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const first = makeUniqueFeedItem({ feedId: feed.id });
        const second = makeUniqueFeedItem({ feedId: feed.id });
        yield* items.create(alice, [first, second]);
        const ids = [first.id, second.id, first.id];

        yield* items.markRead(alice, ids, true);
        yield* items.markRead(alice, ids, true);

        expect(Option.getOrThrow(yield* items.find(alice, first.id)).read).toBe(
          true
        );
        expect(
          Option.getOrThrow(yield* items.find(alice, second.id)).read
        ).toBe(true);

        yield* items.markRead(alice, ids, false);

        expect(Option.getOrThrow(yield* items.find(alice, first.id)).read).toBe(
          false
        );
        expect(
          Option.getOrThrow(yield* items.find(alice, second.id)).read
        ).toBe(false);
      }).pipe(Effect.provide(layer))
  );
};

const markReadEmptyIdsCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('FD-READ-1 changes nothing for an empty id list', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const item = makeUniqueFeedItem({ feedId: feed.id });
      yield* items.create(alice, [item]);

      yield* items.markRead(alice, [], true);

      expect(Option.getOrThrow(yield* items.find(alice, item.id))).toEqual(
        item
      );
    }).pipe(Effect.provide(layer))
  );
};

const setExtractedContentCases = (layer: FeedStoreLayer) => (): void => {
  it.effect(
    'FD-EXTRACT sets the extracted content and reports whether the item exists',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const item = makeUniqueFeedItem({ feedId: feed.id });
        const content = ArticleContent.make('<p>Extracted</p>');
        yield* items.create(alice, [item]);

        expect(yield* items.setExtractedContent(alice, item.id, content)).toBe(
          true
        );

        const stored = Option.getOrThrow(yield* items.find(alice, item.id));

        expect(Option.getOrThrow(stored.extractedContent)).toBe(content);
        expect(stored.read).toBe(false);
        expect(
          yield* items.setExtractedContent(
            alice,
            makeUniqueFeedItem().id,
            content
          )
        ).toBe(false);
      }).pipe(Effect.provide(layer))
  );
};

const setForeignExtractedContentCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('FD-EXTRACT changes nothing for the item of another owner', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const bobFeed = yield* storedFeed(bob);
      const foreign = makeUniqueFeedItem({ feedId: bobFeed.id, ownerId: bob });
      const content = ArticleContent.make('<p>Extracted</p>');
      yield* items.create(bob, [foreign]);

      expect(yield* items.setExtractedContent(alice, foreign.id, content)).toBe(
        false
      );
      expect(Option.getOrThrow(yield* items.find(bob, foreign.id))).toEqual(
        foreign
      );
    }).pipe(Effect.provide(layer))
  );
};

const markFeedCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('marks only the items of the owner feeds among the ids', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const marked = yield* storedFeed();
      const untouched = yield* storedFeed();
      const bobFeed = yield* storedFeed(bob);
      const mine = makeUniqueFeedItem({ feedId: marked.id });
      const other = makeUniqueFeedItem({ feedId: untouched.id });
      const foreign = makeUniqueFeedItem({ feedId: bobFeed.id, ownerId: bob });
      yield* items.create(alice, [mine, other]);
      yield* items.create(bob, [foreign]);
      yield* items.markReadByFeeds(alice, [marked.id, bobFeed.id]);

      expect(Option.getOrThrow(yield* items.find(alice, mine.id)).read).toBe(
        true
      );
      expect(Option.getOrThrow(yield* items.find(alice, other.id)).read).toBe(
        false
      );
      expect(Option.getOrThrow(yield* items.find(bob, foreign.id)).read).toBe(
        false
      );
    }).pipe(Effect.provide(layer))
  );
};

const markAllCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('marks only the items of the owner', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const bobFeed = yield* storedFeed(bob);
      const mine = makeUniqueFeedItem({ feedId: feed.id });
      const foreign = makeUniqueFeedItem({ feedId: bobFeed.id, ownerId: bob });
      yield* items.create(alice, [mine]);
      yield* items.create(bob, [foreign]);
      yield* items.markAllRead(alice);

      expect(Option.getOrThrow(yield* items.find(alice, mine.id)).read).toBe(
        true
      );
      expect(Option.getOrThrow(yield* items.find(bob, foreign.id)).read).toBe(
        false
      );
    }).pipe(Effect.provide(layer))
  );
};

const unreadCountCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('counts the unread items per feed of the owner', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const quiet = yield* storedFeed();
      const bobFeed = yield* storedFeed(bob);
      yield* items.create(alice, [
        makeUniqueFeedItem({ feedId: feed.id }),
        makeUniqueFeedItem({ feedId: feed.id }),
        makeUniqueFeedItem({ feedId: feed.id, read: true }),
        makeUniqueFeedItem({ feedId: quiet.id }),
      ]);
      yield* items.create(bob, [
        makeUniqueFeedItem({ feedId: bobFeed.id, ownerId: bob }),
      ]);

      const counts = yield* items.unreadCounts(alice);

      expect(unreadFor(counts, feed.id)).toBe(2);
      expect(unreadFor(counts, quiet.id)).toBe(1);
      expect(unreadFor(counts, bobFeed.id)).toBe(0);
    }).pipe(Effect.provide(layer))
  );
};

const inventoryCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('returns the id and url of the feed items newest first', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const other = yield* storedFeed();
      const first = makeUniqueFeedItem({ feedId: feed.id });
      const second = makeUniqueFeedItem({ feedId: feed.id });
      yield* items.create(alice, [first, second]);
      yield* items.create(alice, [makeUniqueFeedItem({ feedId: other.id })]);

      expect(yield* items.inventory(alice, feed.id)).toEqual([
        { id: second.id, url: second.url },
        { id: first.id, url: first.url },
      ]);
      expect(yield* items.inventory(bob, feed.id)).toEqual([]);
    }).pipe(Effect.provide(layer))
  );
};

const removeCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('removes the owner items among the ids and ignores others', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const bobFeed = yield* storedFeed(bob);
      const removed = makeUniqueFeedItem({ feedId: feed.id });
      const kept = makeUniqueFeedItem({ feedId: feed.id });
      const foreign = makeUniqueFeedItem({ feedId: bobFeed.id, ownerId: bob });
      yield* items.create(alice, [removed, kept]);
      yield* items.create(bob, [foreign]);
      yield* items.remove(alice, [
        removed.id,
        foreign.id,
        makeUniqueFeedItem().id,
      ]);
      yield* items.remove(alice, [removed.id]);

      expect(Option.isNone(yield* items.find(alice, removed.id))).toBe(true);
      expect(Option.isSome(yield* items.find(alice, kept.id))).toBe(true);
      expect(Option.isSome(yield* items.find(bob, foreign.id))).toBe(true);
    }).pipe(Effect.provide(layer))
  );
};

const updateCases = (layer: FeedStoreLayer) => (): void => {
  describe('scope', markReadScopeCases(layer));
  describe('repeated and back', markReadRepeatCases(layer));
  describe('empty id list', markReadEmptyIdsCases(layer));
  describe('extracted content', setExtractedContentCases(layer));
  describe(
    'extracted content of another owner',
    setForeignExtractedContentCases(layer)
  );
};

export {
  inventoryCases,
  markAllCases,
  markFeedCases,
  removeCases,
  unreadCountCases,
  updateCases,
};
