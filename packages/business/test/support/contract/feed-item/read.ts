import { describe, expect, it } from '@effect/vitest';
import { Effect, Option } from 'effect';
import { ArticleContent } from '../../../../src/entity/common/article';
import { FeedItemRepository } from '../../../../src/port/feed-item-repository';
import { alice, bob, feedItemQuery, itemRow, storedFeed } from '../../fixtures';
import type { FeedStoreFactory } from '../layer';

const markReadScopeCase = (makeLayer: FeedStoreFactory): void => {
  it.effect(
    'FD-READ-1 marks the owner items among the ids and ignores others',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const bobFeed = yield* storedFeed(bob);
        const mine = itemRow(feed.id);
        const foreign = itemRow(bobFeed.id, { ownerId: bob });
        yield* items.create(alice, [mine]);
        yield* items.create(bob, [foreign]);

        yield* items.markRead(
          alice,
          [mine.id, foreign.id, mine.id, itemRow(feed.id).id],
          true
        );

        expect(Option.getOrThrow(yield* items.find(alice, mine.id)).read).toBe(
          true
        );
        expect(Option.getOrThrow(yield* items.find(bob, foreign.id)).read).toBe(
          false
        );
      }).pipe(Effect.provide(makeLayer()))
  );
};

const markReadTwiceCase = (makeLayer: FeedStoreFactory): void => {
  it.effect(
    'FD-READ-4 marking twice is idempotent and marking back clears read',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const first = itemRow(feed.id);
        const second = itemRow(feed.id);
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
      }).pipe(Effect.provide(makeLayer()))
  );
};

const markReadEmptyCase = (makeLayer: FeedStoreFactory): void => {
  it.effect('CM-PORT-5 an empty id list changes nothing', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const item = itemRow(feed.id);
      yield* items.create(alice, [item]);

      yield* items.markRead(alice, [], true);

      expect(yield* items.listAll(alice, feedItemQuery())).toEqual([item]);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const extractedContentCase = (makeLayer: FeedStoreFactory): void => {
  it.effect('FD-EXTRACT stores the extracted content and returns true', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const feed = yield* storedFeed();
      const item = itemRow(feed.id);
      const content = ArticleContent.make('<p>Extracted</p>');
      yield* items.create(alice, [item]);

      expect(yield* items.setExtractedContent(alice, item.id, content)).toBe(
        true
      );

      const stored = Option.getOrThrow(yield* items.find(alice, item.id));

      expect(Option.getOrThrow(stored.extractedContent)).toBe(content);
      expect(stored.read).toBe(false);
      expect(stored.title).toBe(item.title);
    }).pipe(Effect.provide(makeLayer()))
  );
};

const unknownExtractedCase = (makeLayer: FeedStoreFactory): void => {
  it.effect(
    'CM-PORT-5 returns false for an unknown item and writes nothing',
    () =>
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const feed = yield* storedFeed();
        const content = ArticleContent.make('<p>Extracted</p>');
        const unknown = itemRow(feed.id);

        expect(
          yield* items.setExtractedContent(alice, unknown.id, content)
        ).toBe(false);
      }).pipe(Effect.provide(makeLayer()))
  );
};

const foreignExtractedCase = (makeLayer: FeedStoreFactory): void => {
  it.effect('CM-OWN-3 returns false for the item of another owner', () =>
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;
      const bobFeed = yield* storedFeed(bob);
      const foreign = itemRow(bobFeed.id, { ownerId: bob });
      const content = ArticleContent.make('<p>Extracted</p>');
      yield* items.create(bob, [foreign]);

      expect(yield* items.setExtractedContent(alice, foreign.id, content)).toBe(
        false
      );
      expect(Option.getOrThrow(yield* items.find(bob, foreign.id))).toEqual(
        foreign
      );
    }).pipe(Effect.provide(makeLayer()))
  );
};

export const readCases = (makeLayer: FeedStoreFactory) => (): void => {
  describe('mark read by id', () => {
    markReadScopeCase(makeLayer);
    markReadTwiceCase(makeLayer);
    markReadEmptyCase(makeLayer);
  });
  describe('extracted content', () => {
    extractedContentCase(makeLayer);
    unknownExtractedCase(makeLayer);
    foreignExtractedCase(makeLayer);
  });
};
