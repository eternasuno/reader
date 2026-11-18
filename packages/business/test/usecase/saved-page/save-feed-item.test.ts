import { describe, expect, it } from '@effect/vitest';
import { DateTime, Effect, Option } from 'effect';
import {
  ArticleContent,
  ArticleDescription,
} from '../../../src/entity/common/article';
import { WebpageFetcherError } from '../../../src/error/common';
import {
  FeedItemRepository,
  type IFeedItemRepository,
} from '../../../src/port/feed-item-repository';
import { SavedPageRepository } from '../../../src/port/saved-page-repository';
import { saveFeedItem } from '../../../src/usecase/saved-page/save-feed-item';
import {
  alice,
  bob,
  makeUniqueFeedItem,
  makeUniqueSavedPage,
  storedFeed,
} from '../../support/fixtures';
import { memoryFeedStoreLayer } from '../../support/memory/feed-store';
import {
  asAlreadyExists,
  asItemNotFound,
  run,
  savedPageLayer,
  storedItem,
  storedPages,
  storeFeedItem,
} from './harness';

const publishedAt = DateTime.fromDateUnsafe(
  new Date('2026-02-01T00:00:00.000Z')
);

const feedContent = ArticleContent.make('<p>Feed content</p>');

describe('saveFeedItem copy', () => {
  it.effect(
    'SP-SAVE-2 SP-SAVE-9 copies the item into a new unread page on top',
    () =>
      run(
        Effect.gen(function* () {
          const pages = yield* SavedPageRepository;
          const earlier = makeUniqueSavedPage();
          const item = yield* storeFeedItem({
            description: Option.some(ArticleDescription.make('Item summary')),
            content: Option.some(feedContent),
            publishedAt: Option.some(publishedAt),
          });

          yield* pages.create(alice, [earlier]);

          const page = yield* saveFeedItem(alice, item.id);

          expect(page.id).not.toBe(earlier.id);
          expect(page.id > earlier.id).toBe(true);
          expect(page.url).toStrictEqual(item.url);
          expect(page.title).toBe(item.title);
          expect(Option.getOrThrow(page.description)).toBe('Item summary');
          expect(Option.getOrThrow(page.publishedAt)).toBe(publishedAt);
          expect(page.content).toBe(feedContent);
          expect(page.read).toBe(false);
          expect(yield* storedPages()).toStrictEqual([page, earlier]);
          expect(yield* storedItem(item)).toStrictEqual(item);
        })
      )
  );
});

describe('saveFeedItem content priority', () => {
  it.effect('SP-SAVE-8 takes the extracted content without fetching', () => {
    const fetched: Array<string> = [];

    return run(
      Effect.gen(function* () {
        const extracted = ArticleContent.make('<p>Extracted</p>');
        const item = yield* storeFeedItem({
          extractedContent: Option.some(extracted),
          content: Option.some(feedContent),
        });
        const page = yield* saveFeedItem(alice, item.id);

        expect(page.content).toBe(extracted);
        expect(fetched).toEqual([]);
      }),
      {
        fetch: (href) => {
          fetched.push(href);

          return Effect.succeed('<html><body>page</body></html>');
        },
      }
    );
  });

  it.effect('SP-SAVE-8 takes the feed content without fetching', () => {
    const fetched: Array<string> = [];

    return run(
      Effect.gen(function* () {
        const item = yield* storeFeedItem({
          content: Option.some(feedContent),
        });
        const page = yield* saveFeedItem(alice, item.id);

        expect(page.content).toBe(feedContent);
        expect(fetched).toEqual([]);
      }),
      {
        fetch: (href) => {
          fetched.push(href);

          return Effect.succeed('<html><body>page</body></html>');
        },
      }
    );
  });

  it.effect('SP-SAVE-8 fetches the page when the item has no content', () => {
    const fetched: Array<string> = [];

    return run(
      Effect.gen(function* () {
        const item = yield* storeFeedItem();
        const page = yield* saveFeedItem(alice, item.id);

        expect(page.content).toBe('<p>Fetched</p>');
        expect(fetched).toEqual([item.url.href]);
      }),
      {
        fetch: (href) => {
          fetched.push(href);

          return Effect.succeed('<html><body>page</body></html>');
        },
      }
    );
  });
});

describe('saveFeedItem missing items', () => {
  it.effect('SP-SAVE-1 fails for an item that does not exist', () =>
    run(
      Effect.gen(function* () {
        const missing = makeUniqueFeedItem({ ownerId: alice });
        const error = yield* saveFeedItem(alice, missing.id).pipe(Effect.flip);

        expect(asItemNotFound(error).id).toBe(missing.id);
        expect(yield* storedPages()).toStrictEqual([]);
      })
    )
  );

  it.effect('SP-SAVE-1 treats another owner’s item as missing', () =>
    run(
      Effect.gen(function* () {
        const feed = yield* storedFeed(bob);
        const items = yield* FeedItemRepository;
        const item = makeUniqueFeedItem({ ownerId: bob, feedId: feed.id });

        yield* items.create(bob, [item]);

        const error = yield* saveFeedItem(alice, item.id).pipe(Effect.flip);

        expect(asItemNotFound(error).id).toBe(item.id);
        expect(yield* storedPages()).toStrictEqual([]);
      })
    )
  );
});

describe('saveFeedItem duplicates', () => {
  it.effect('SP-SAVE-3 detects a duplicate before fetching', () => {
    const fetched: Array<string> = [];

    return run(
      Effect.gen(function* () {
        const pages = yield* SavedPageRepository;
        const item = yield* storeFeedItem();
        const saved = makeUniqueSavedPage({ url: item.url });

        yield* pages.create(alice, [saved]);

        const error = yield* saveFeedItem(alice, item.id).pipe(Effect.flip);

        expect(asAlreadyExists(error).url.href).toBe(item.url.href);
        expect(fetched).toEqual([]);
        expect(yield* storedPages()).toStrictEqual([saved]);
      }),
      {
        fetch: (href) => {
          fetched.push(href);

          return Effect.succeed('<html><body>page</body></html>');
        },
      }
    );
  });
});

describe('saveFeedItem failures', () => {
  it.effect('SP-SAVE-6 saves nothing when the content cannot be fetched', () =>
    run(
      Effect.gen(function* () {
        const item = yield* storeFeedItem();
        const error = yield* saveFeedItem(alice, item.id).pipe(Effect.flip);

        expect(error._tag).toBe('WebpageFetcherError');
        expect(yield* storedPages()).toStrictEqual([]);
      }),
      {
        fetch: () => Effect.fail(new WebpageFetcherError({ message: 'fetch' })),
      }
    )
  );
});

/** Removes the item as soon as it was read, as retention would (SP-SAVE-10). */
const removeAfterFind = (items: IFeedItemRepository): IFeedItemRepository => ({
  ...items,
  find: (owner, id) =>
    items
      .find(owner, id)
      .pipe(
        Effect.tap((found) =>
          Option.isSome(found) ? items.remove(owner, [id]) : Effect.void
        )
      ),
});

describe('saveFeedItem vanished item', () => {
  it.effect('SP-SAVE-10 saves the copy found before the item disappears', () =>
    Effect.gen(function* () {
      const item = yield* storeFeedItem({ content: Option.some(feedContent) });
      const page = yield* saveFeedItem(alice, item.id);

      expect(page.url).toStrictEqual(item.url);
      expect(yield* storedPages()).toStrictEqual([page]);
      expect(yield* storedItem(item)).toBeUndefined();
    }).pipe(
      Effect.provide(savedPageLayer({}, memoryFeedStoreLayer(removeAfterFind)))
    )
  );
});
