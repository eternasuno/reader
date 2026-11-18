import { describe, expect, it } from '@effect/vitest';
import { Deferred, Effect, Option, Ref } from 'effect';
import {
  ArticleContent,
  type ExtractedArticle,
} from '../../../src/entity/common/article';
import { WebpageFetcherError } from '../../../src/error/common';
import {
  FeedItemRepository,
  type IFeedItemRepository,
} from '../../../src/port/feed-item-repository';
import type { HtmlDocument } from '../../../src/port/html-parser';
import { extractItem } from '../../../src/usecase/feed-item/extract-item';
import { alice, makeUniqueFeedItem, rowAt } from '../../support/fixtures';
import { memoryFeedStoreLayer } from '../../support/memory/feed-store';
import { fetchedArticle } from '../common/harness';
import {
  feedItemLayer,
  runItems,
  storedItems,
  storeFeedWithItems,
} from './harness';

const pageHtml = '<html><body><p>Page</p></body></html>';

/** The stub parsed document keeps the page text, so a double can echo it. */
const htmlOf = (document: HtmlDocument): string =>
  (document as unknown as { readonly html: string }).html;

const extractFromDocument = (document: HtmlDocument): ExtractedArticle =>
  fetchedArticle({
    content: Option.some(ArticleContent.make(htmlOf(document))),
  });

describe('extractItem missing items', () => {
  it.effect('FD-EXTRACT fails for an unknown item without fetching', () => {
    const fetched: Array<string> = [];

    return runItems(
      Effect.gen(function* () {
        const missing = makeUniqueFeedItem({ ownerId: alice });
        const error = yield* extractItem(alice, missing.id).pipe(Effect.flip);

        expect(error._tag).toBe('FeedItemNotFound');
        expect(fetched).toEqual([]);
      }),
      {
        fetch: (href) => {
          fetched.push(href);

          return Effect.succeed(pageHtml);
        },
      }
    );
  });
});

describe('extractItem', () => {
  it.effect(
    'FD-EXTRACT-2 reuses the stored extraction without fetching',
    () => {
      const fetched: Array<string> = [];

      return runItems(
        Effect.gen(function* () {
          const stored = ArticleContent.make('<p>Already extracted</p>');
          const { items } = yield* storeFeedWithItems(1, {
            extractedContent: Option.some(stored),
          });
          const item = rowAt(items, 0);
          const extracted = yield* extractItem(alice, item.id);

          expect(extracted).toStrictEqual(item);
          expect(fetched).toEqual([]);
        }),
        {
          fetch: (href) => {
            fetched.push(href);

            return Effect.succeed(pageHtml);
          },
        }
      );
    }
  );
});

describe('extractItem extraction', () => {
  it.effect('FD-EXTRACT fetches the item url, extracts and stores it', () => {
    const fetched: Array<string> = [];
    const parsed: Array<string> = [];

    return runItems(
      Effect.gen(function* () {
        const { items } = yield* storeFeedWithItems(1);
        const item = rowAt(items, 0);
        const extracted = yield* extractItem(alice, item.id);
        const stored = yield* storedItems(item.feedId);

        expect(Option.getOrThrow(extracted.extractedContent)).toBe(
          '<p>Fetched</p>'
        );
        expect(Option.getOrThrow(rowAt(stored, 0).extractedContent)).toBe(
          '<p>Fetched</p>'
        );
        expect(fetched).toEqual([item.url.href]);
        expect(parsed).toEqual([item.url.href]);
      }),
      {
        fetch: (href) => {
          fetched.push(href);

          return Effect.succeed(pageHtml);
        },
        parse: (html, url) => {
          parsed.push(url.href);

          return Effect.succeed({ html } as unknown as HtmlDocument);
        },
      }
    );
  });
});

describe('extractItem failures', () => {
  it.effect('FD-EXTRACT-1 stores nothing when the page cannot be fetched', () =>
    runItems(
      Effect.gen(function* () {
        const { items } = yield* storeFeedWithItems(1);
        const item = rowAt(items, 0);
        const error = yield* extractItem(alice, item.id).pipe(Effect.flip);
        const stored = yield* storedItems(item.feedId);

        expect(error._tag).toBe('WebpageFetcherError');
        expect(rowAt(stored, 0).extractedContent).toStrictEqual(Option.none());
      }),
      {
        fetch: () => Effect.fail(new WebpageFetcherError({ message: 'fetch' })),
      }
    )
  );

  it.effect('FD-EXTRACT-1 fails and stores nothing on empty content', () =>
    runItems(
      Effect.gen(function* () {
        const { items } = yield* storeFeedWithItems(1);
        const item = rowAt(items, 0);
        const error = yield* extractItem(alice, item.id).pipe(Effect.flip);
        const stored = yield* storedItems(item.feedId);

        expect(error._tag).toBe('ArticleEmptyContent');
        expect(rowAt(stored, 0).extractedContent).toStrictEqual(Option.none());
      }),
      {
        extract: () =>
          Effect.succeed(fetchedArticle({ content: Option.none() })),
      }
    )
  );
});

/** Removes the item before its content is written, as retention would. */
const removeBeforeWrite = (
  items: IFeedItemRepository
): IFeedItemRepository => ({
  ...items,
  setExtractedContent: (owner, id, content) =>
    items
      .remove(owner, [id])
      .pipe(Effect.andThen(items.setExtractedContent(owner, id, content))),
});

describe('extractItem vanished item', () => {
  it.effect('FD-EXTRACT fails when the item disappears during the fetch', () =>
    Effect.gen(function* () {
      const { items } = yield* storeFeedWithItems(1);
      const item = rowAt(items, 0);

      const error = yield* extractItem(alice, item.id).pipe(Effect.flip);

      expect(error._tag).toBe('FeedItemNotFound');
      expect(yield* storedItems(item.feedId)).toStrictEqual([]);
    }).pipe(
      Effect.provide(feedItemLayer({}, memoryFeedStoreLayer(removeBeforeWrite)))
    )
  );
});

const gatedFetch =
  (arrivals: Ref.Ref<number>, gate: Deferred.Deferred<void>) => () =>
    Effect.gen(function* () {
      const arrival = yield* Ref.updateAndGet(arrivals, (value) => value + 1);

      if (arrival === 2) {
        yield* Deferred.succeed(gate, void 0);
      }

      yield* Deferred.await(gate);

      return `<html><body>page ${arrival}</body></html>`;
    });

/** The first write finishes before the second, so the last one is known. */
const racingWrites =
  (
    writes: Ref.Ref<number>,
    firstWritten: Deferred.Deferred<void>,
    last: Ref.Ref<string>
  ) =>
  (items: IFeedItemRepository): IFeedItemRepository => ({
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
/** Extracts the same item twice at once and reports both results and the store. */
const raceExtractions = (
  racing: (items: IFeedItemRepository) => IFeedItemRepository
) =>
  Effect.gen(function* () {
    const { items: rows } = yield* storeFeedWithItems(1);
    const item = rowAt(rows, 0);
    const items = yield* FeedItemRepository;
    const extract = extractItem(alice, item.id).pipe(
      Effect.provideService(FeedItemRepository, racing(items))
    );
    const extracted = yield* Effect.all([extract, extract], {
      concurrency: 'unbounded',
    });
    const stored = yield* storedItems(item.feedId);

    return {
      contents: extracted.map((entry) =>
        Option.getOrThrow(entry.extractedContent)
      ),
      stored: Option.getOrThrow(rowAt(stored, 0).extractedContent),
    };
  });

describe('extractItem concurrent extractions', () => {
  it.effect(
    'FD-EXTRACT-2 each extraction returns its own result, last write wins',
    () =>
      Effect.gen(function* () {
        const arrivals = yield* Ref.make(0);
        const gate = yield* Deferred.make<void>();
        const writes = yield* Ref.make(0);
        const firstWritten = yield* Deferred.make<void>();
        const last = yield* Ref.make('');

        const result = yield* raceExtractions(
          racingWrites(writes, firstWritten, last)
        ).pipe(
          Effect.provide(
            feedItemLayer({
              fetch: gatedFetch(arrivals, gate),
              parse: (html) =>
                Effect.succeed({ html } as unknown as HtmlDocument),
              extract: (document) =>
                Effect.succeed(extractFromDocument(document)),
            })
          )
        );

        expect(yield* Ref.get(arrivals)).toBe(2);
        expect(new Set(result.contents).size).toBe(2);
        expect(result.contents).toContain(result.stored);
        expect(result.stored).toBe(yield* Ref.get(last));
      })
  );
});
