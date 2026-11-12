import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { ArticleContent } from '../../src/entity/common/article';
import type { FeedUnreadCount } from '../../src/port/feed-item-repository';
import { FeedItemRepository } from '../../src/port/feed-item-repository';
import { alice, bob, makeUniqueFeedItem, storedFeed } from '../support';
import type { FeedStoreLayer } from './feed-repository-contract';

const unreadFor = (
  counts: ReadonlyArray<FeedUnreadCount>,
  feedId: string
): number => counts.find((count) => count.feedId === feedId)?.count ?? 0;

const updateResultCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('returns the existing ids once and ignores foreign ids', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const bobFeed = yield* storedFeed(bob);
      const mine = makeUniqueFeedItem({ feedId: feed.id });
      const foreign = makeUniqueFeedItem({ feedId: bobFeed.id, ownerId: bob });
      yield* items.create(alice, [mine]);
      yield* items.create(bob, [foreign]);

      const updated = yield* items.update(
        alice,
        [mine.id, foreign.id, mine.id, makeUniqueFeedItem().id],
        { read: true }
      );

      expect(updated).toEqual([mine.id]);
      expect(Option.getOrThrow(yield* items.find(bob, foreign.id)).read).toBe(
        false
      );
    }).pipe(Effect.provide(layer))
  );
};

const updateRepeatCases = (layer: FeedStoreLayer) => (): void => {
  it.effect(
    'returns each existing id once for a repeated patch and for an empty one',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const first = makeUniqueFeedItem({ feedId: feed.id });
        const second = makeUniqueFeedItem({ feedId: feed.id });
        yield* items.create(alice, [first, second]);
        const ids = [first.id, second.id, first.id];

        const patched = yield* items.update(alice, ids, { read: true });
        const again = yield* items.update(alice, ids, { read: true });
        const emptyPatch = yield* items.update(alice, ids, {});

        const both = new Set([first.id, second.id]);

        expect(patched).toHaveLength(2);
        expect(new Set(patched)).toEqual(both);
        expect(new Set(again)).toEqual(both);
        expect(emptyPatch).toHaveLength(2);
        expect(new Set(emptyPatch)).toEqual(both);
      }).pipe(Effect.provide(layer))
  );
};

const updateEmptyIdsCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('changes nothing for an empty id list', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const item = makeUniqueFeedItem({ feedId: feed.id });
      yield* items.create(alice, [item]);

      expect(yield* items.update(alice, [], { read: true })).toEqual([]);
      expect(Option.getOrThrow(yield* items.find(alice, item.id))).toEqual(
        item
      );
    }).pipe(Effect.provide(layer))
  );
};

const updatePatchCases = (layer: FeedStoreLayer) => (): void => {
  it.effect('sets read and extracted content and clears it with none', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const item = makeUniqueFeedItem({ feedId: feed.id });
      const content = ArticleContent.make('<p>Extracted</p>');
      yield* items.create(alice, [item]);
      yield* items.update(alice, [item.id], {
        extractedContent: Option.some(content),
        read: true,
      });

      const extracted = Option.getOrThrow(yield* items.find(alice, item.id));

      expect(extracted.read).toBe(true);
      expect(Option.getOrThrow(extracted.extractedContent)).toBe(content);

      yield* items.update(alice, [item.id], {
        extractedContent: Option.none(),
      });

      const cleared = Option.getOrThrow(yield* items.find(alice, item.id));

      expect(cleared.read).toBe(true);
      expect(Option.isNone(cleared.extractedContent)).toBe(true);
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
      yield* items.updateByFeeds(alice, [marked.id, bobFeed.id], {
        read: true,
      });

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
      yield* items.updateAll(alice, { read: true });

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
  describe('result', updateResultCases(layer));
  describe('repeated and empty patch', updateRepeatCases(layer));
  describe('empty id list', updateEmptyIdsCases(layer));
  describe('patch', updatePatchCases(layer));
};

export {
  inventoryCases,
  markAllCases,
  markFeedCases,
  removeCases,
  unreadCountCases,
  updateCases,
};
