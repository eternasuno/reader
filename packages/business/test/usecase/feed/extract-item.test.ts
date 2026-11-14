import { describe, expect, it } from '@effect/vitest';
import { Deferred, Effect, Layer, Option, Ref } from 'effect';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import type { FeedItemId } from '../../../src/entity/feed/feed-item';
import { ArticleExtractor } from '../../../src/port/article-extractor';
import {
  FeedItemRepository,
  type IFeedItemRepository,
} from '../../../src/port/feed-item-repository';
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

const htmlOf = (document: Document): string =>
  (document.body as unknown as { readonly innerHTML: string }).innerHTML;

const gatedFetch =
  (arrivals: Ref.Ref<number>, gate: Deferred.Deferred<void>) =>
  (): Effect.Effect<string> =>
    Effect.gen(function* () {
      const arrival = yield* Ref.updateAndGet(arrivals, (value) => value + 1);

      if (arrival === 2) {
        yield* Deferred.succeed(gate, void 0);
      }

      yield* Deferred.await(gate);

      return `<p>page ${arrival}</p>`;
    });

// The first write finishes before the second, so the last one is known.
const racingItems = (
  items: IFeedItemRepository,
  writes: Ref.Ref<number>,
  firstWritten: Deferred.Deferred<void>,
  last: Ref.Ref<string>
): IFeedItemRepository => ({
  ...items,
  setExtractedContent: (owner, id, content) =>
    Effect.gen(function* () {
      const count = yield* Ref.updateAndGet(writes, (value) => value + 1);

      if (count === 1) {
        const stored = yield* items.setExtractedContent(owner, id, content);
        yield* Deferred.succeed(firstWritten, void 0);

        return stored;
      }

      yield* Deferred.await(firstWritten);
      yield* Ref.set(last, content);

      return yield* items.setExtractedContent(owner, id, content);
    }),
});

describe('extractItem concurrent extractions', () => {
  it.effect(
    'FD-EXTRACT-2 each extraction returns its own result and the last write wins',
    () =>
      Effect.gen(function* () {
        const arrivals = yield* Ref.make(0);
        const gate = yield* Deferred.make<void>();
        const writes = yield* Ref.make(0);
        const firstWritten = yield* Deferred.make<void>();
        const last = yield* Ref.make('');

        const result = yield* run(
          Effect.gen(function* () {
            const items = yield* FeedItemRepository;
            const racing = racingItems(items, writes, firstWritten, last);
            const { item } = yield* storeFeedWithItem();
            const extract = extractItem(alice, item.id).pipe(
              Effect.provideService(FeedItemRepository, racing)
            );
            const extracted = yield* Effect.all([extract, extract], {
              concurrency: 'unbounded',
            });
            const stored = yield* storedItems(alice, item.feedId);

            return {
              contents: extracted.map((entry) =>
                Option.getOrThrow(entry.extractedContent)
              ),
              stored: Option.getOrThrow(rowAt(stored, 0).extractedContent),
            };
          }),
          {
            fetchPage: gatedFetch(arrivals, gate),
            parseHtml: (html) => Effect.succeed(parsedDocument(html)),
            extract: (document) =>
              Effect.succeed(
                extractedArticle({ content: decodeContent(htmlOf(document)) })
              ),
          }
        );

        expect(yield* Ref.get(arrivals)).toBe(2);
        expect(new Set(result.contents).size).toBe(2);
        expect(result.contents).toContain(result.stored);
        expect(result.stored).toBe(yield* Ref.get(last));
      })
  );
});
