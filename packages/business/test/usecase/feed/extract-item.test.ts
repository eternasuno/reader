import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Option, Ref } from 'effect';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import type { FeedItemId } from '../../../src/entity/feed/feed-item';
import { ArticleExtractor } from '../../../src/port/article-extractor';
import { FeedItemRepository } from '../../../src/port/feed-item-repository';
import { HtmlParser } from '../../../src/port/html-parser';
import {
  WebpageFetcher,
  WebpageFetcherError,
} from '../../../src/port/webpage-fetcher';
import { FeedItemNotFound } from '../../../src/usecase/feed/errors';
import { extractItem } from '../../../src/usecase/feed/extract-item';
import {
  alice,
  decodeContent,
  makeFeedItem,
  makeUniqueFeed,
  makeUniqueFeedItem,
  parsedDocument,
} from '../../support/fixtures';
import { memoryFeedStoreLayer } from '../../support/memory/feed-store';
import {
  defaultExtract,
  defaultParseHtml,
  extractedArticle,
  rowAt,
  run,
  storedItems,
  storeFeed,
  storeFeedWithItem,
  storeItems,
} from '../../support/usecase/feed';

const existingContent = decodeContent('<p>Already extracted</p>');

const recordFetch =
  (fetched: Ref.Ref<number>) =>
  (target: string): Effect.Effect<string> =>
    Ref.update(fetched, (count) => count + 1).pipe(
      Effect.as(`<p>${target}</p>`)
    );

describe('extractItem missing items', () => {
  it.effect('fails for an unknown item without fetching', () =>
    Effect.gen(function* () {
      const missing = makeUniqueFeedItem({ ownerId: alice });
      const fetched = yield* Ref.make(0);
      const error = yield* run(extractItem(alice, missing.id), {
        fetchPage: recordFetch(fetched),
      }).pipe(Effect.flip);

      expect(error).toStrictEqual(new FeedItemNotFound({ id: missing.id }));
      expect(yield* Ref.get(fetched)).toBe(0);
    })
  );
});

describe('extractItem extraction', () => {
  it.effect('reuses the stored extraction without fetching', () =>
    Effect.gen(function* () {
      const fetched = yield* Ref.make(0);
      const result = yield* run(
        Effect.gen(function* () {
          const { item } = yield* storeFeedWithItem({
            extractedContent: existingContent,
          });

          return {
            item,
            extracted: yield* extractItem(alice, item.id),
          };
        }),
        { fetchPage: recordFetch(fetched) }
      );

      expect(result.extracted).toStrictEqual(result.item);
      expect(yield* Ref.get(fetched)).toBe(0);
    })
  );
});

describe('extractItem extraction storage', () => {
  it.effect('stores and returns the extracted content', () =>
    Effect.gen(function* () {
      const fetched: Array<string> = [];
      const parsed: Array<string> = [];
      const result = yield* run(
        Effect.gen(function* () {
          const { item } = yield* storeFeedWithItem();

          return {
            item,
            extracted: yield* extractItem(alice, item.id),
            stored: yield* storedItems(alice, item.feedId),
          };
        }),
        {
          fetchPage: (target) => {
            fetched.push(target);

            return Effect.succeed('<p>Page</p>');
          },
          parseHtml: (html, url) => {
            parsed.push(url.href);

            return Effect.succeed(parsedDocument(html));
          },
        }
      );

      expect(Option.getOrThrow(result.extracted.extractedContent)).toBe(
        '<p>Extracted</p>'
      );
      expect(Option.getOrThrow(rowAt(result.stored, 0).extractedContent)).toBe(
        '<p>Extracted</p>'
      );
      expect(fetched).toEqual([result.item.url.href]);
      expect(parsed).toEqual([result.item.url.href]);
    })
  );
});

const vanishingLayer = (owner: OwnerId, id: FeedItemId) => {
  const store = memoryFeedStoreLayer();
  const fetcher = Layer.effect(
    WebpageFetcher,
    Effect.gen(function* () {
      const items = yield* FeedItemRepository;

      return WebpageFetcher.of({
        fetch: () =>
          items
            .remove(owner, [id])
            .pipe(Effect.orDie, Effect.as('<p>Page</p>')),
      });
    })
  );

  return Layer.mergeAll(
    Layer.provide(fetcher, store),
    store,
    Layer.mock(HtmlParser, { parse: defaultParseHtml }),
    Layer.mock(ArticleExtractor, { extract: defaultExtract })
  );
};

describe('extractItem vanished item', () => {
  it.effect('fails when the item disappears during the fetch', () =>
    Effect.gen(function* () {
      const feed = makeUniqueFeed({ ownerId: alice });
      const item = makeFeedItem({ ownerId: alice, feedId: feed.id });

      const error = yield* Effect.gen(function* () {
        yield* storeFeed(feed);
        yield* storeItems(alice, [item]);

        return yield* extractItem(alice, item.id).pipe(Effect.flip);
      }).pipe(Effect.provide(vanishingLayer(alice, item.id)));

      expect(error).toStrictEqual(new FeedItemNotFound({ id: item.id }));
    })
  );
});

describe('extractItem failures', () => {
  it.effect('stores nothing when the page cannot be fetched', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const { item } = yield* storeFeedWithItem();

          return {
            error: yield* extractItem(alice, item.id).pipe(Effect.flip),
            stored: yield* storedItems(alice, item.feedId),
          };
        }),
        {
          fetchPage: () =>
            Effect.fail(new WebpageFetcherError({ message: 'fetch' })),
        }
      );

      expect(result.error).toStrictEqual(
        new WebpageFetcherError({ message: 'fetch' })
      );
      expect(result.stored[0]?.extractedContent).toStrictEqual(Option.none());
    })
  );

  it.effect('fails and stores nothing when the content is empty', () =>
    Effect.gen(function* () {
      const result = yield* run(
        Effect.gen(function* () {
          const { item } = yield* storeFeedWithItem();

          return {
            error: yield* extractItem(alice, item.id).pipe(Effect.flip),
            stored: yield* storedItems(alice, item.feedId),
          };
        }),
        {
          extract: () =>
            Effect.succeed(extractedArticle({ content: Option.none() })),
        }
      );

      expect(result.error._tag).toBe('ArticleEmptyContent');
      expect(result.stored[0]?.extractedContent).toStrictEqual(Option.none());
    })
  );
});
