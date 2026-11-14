import { describe, expect, it } from '@effect/vitest';
import { DateTime, Deferred, Effect, Option, Ref, Result } from 'effect';
import {
  FeedItemRepository,
  type IFeedItemRepository,
} from '../../../src/port/feed-item-repository';
import { SavedPageRepository } from '../../../src/port/saved-page-repository';
import { WebpageFetcherError } from '../../../src/port/webpage-fetcher';
import { saveFeedItem } from '../../../src/usecase/saved-page/save-feed-item';
import {
  alice,
  bob,
  decodeContent,
  decodeDescription,
  decodeTitle,
  decodeUrl,
  makeFeedItem,
  makeSavedPage,
} from '../../support/fixtures';
import {
  asAlreadyExists,
  asNotFound,
  recordingFetch,
  run,
  storedPages,
  storeFeedItem,
} from '../../support/usecase/saved-page';

const publishedAt = DateTime.fromDateUnsafe(
  new Date('2026-02-01T00:00:00.000Z')
);

describe('saveFeedItem lookup', () => {
  it.effect('SP-SAVE-1 fails for an unknown item and saves nothing', () =>
    run(
      Effect.gen(function* () {
        const item = makeFeedItem();
        const error = yield* saveFeedItem(alice, item.id).pipe(Effect.flip);

        expect(asNotFound(error).id).toBe(item.id);
        expect(yield* storedPages(alice)).toEqual([]);
      })
    )
  );

  it.effect("SP-SAVE-1 fails for another owner's item and saves nothing", () =>
    run(
      Effect.gen(function* () {
        const theirs = yield* storeFeedItem(bob);
        const error = yield* saveFeedItem(alice, theirs.id).pipe(Effect.flip);

        expect(asNotFound(error).id).toBe(theirs.id);
        expect(yield* storedPages(alice)).toEqual([]);
        expect(yield* storedPages(bob)).toEqual([]);
      })
    )
  );

  it.effect('SP-SAVE-3 detects a duplicate before fetching', () => {
    const fetched: Array<string> = [];

    return run(
      Effect.gen(function* () {
        const repository = yield* SavedPageRepository;
        const item = yield* storeFeedItem(alice);
        const saved = makeSavedPage({ url: item.url });

        yield* repository.create(alice, [saved]);

        const error = yield* saveFeedItem(alice, item.id).pipe(Effect.flip);

        expect(asAlreadyExists(error).url.href).toBe(item.url.href);
        expect(fetched).toEqual([]);
        expect(yield* storedPages(alice)).toEqual([saved]);
      }),
      { fetch: recordingFetch(fetched) }
    );
  });
});

describe('saveFeedItem copy', () => {
  it.effect('SP-SAVE-2 SP-SAVE-5 SP-SAVE-9 copies the item values', () =>
    run(
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const item = yield* storeFeedItem(alice, {
          url: decodeUrl('https://example.com/item/post'),
          title: decodeTitle('Item title'),
          description: decodeDescription('Item description'),
          content: decodeContent('<p>Feed body</p>'),
          publishedAt: Option.some(publishedAt),
        });
        const page = yield* saveFeedItem(alice, item.id);

        expect(page.url.href).toBe(item.url.href);
        expect(page.title).toBe('Item title');
        expect(Option.getOrThrow(page.description)).toBe('Item description');
        expect(Option.getOrThrow(page.publishedAt)).toBe(publishedAt);
        expect(page.content).toBe('<p>Feed body</p>');
        expect(page.read).toBe(false);
        expect(page.id).not.toBe(item.id);

        const unchanged = yield* items.find(alice, item.id);

        expect(Option.getOrThrow(unchanged)).toEqual(item);
      })
    )
  );
});

describe('saveFeedItem content priority', () => {
  it.effect(
    'SP-SAVE-8 prefers the extracted content over the feed content',
    () => {
      const fetched: Array<string> = [];

      return run(
        Effect.gen(function* () {
          const item = yield* storeFeedItem(alice, {
            content: decodeContent('<p>Feed body</p>'),
            extractedContent: decodeContent('<p>Extracted body</p>'),
          });
          const page = yield* saveFeedItem(alice, item.id);

          expect(page.content).toBe('<p>Extracted body</p>');
          expect(fetched).toEqual([]);
        }),
        { fetch: recordingFetch(fetched) }
      );
    }
  );

  it.effect('SP-SAVE-8 falls back to the feed content without fetching', () => {
    const fetched: Array<string> = [];

    return run(
      Effect.gen(function* () {
        const item = yield* storeFeedItem(alice, {
          content: decodeContent('<p>Feed body</p>'),
        });
        const page = yield* saveFeedItem(alice, item.id);

        expect(page.content).toBe('<p>Feed body</p>');
        expect(fetched).toEqual([]);
      }),
      { fetch: recordingFetch(fetched) }
    );
  });

  it.effect('SP-SAVE-8 fetches the item url when it has no content', () => {
    const fetched: Array<string> = [];

    return run(
      Effect.gen(function* () {
        const item = yield* storeFeedItem(alice);
        const page = yield* saveFeedItem(alice, item.id);

        expect(page.content).toBe('<p>Fetched</p>');
        expect(fetched).toEqual([item.url.href]);
      }),
      { fetch: recordingFetch(fetched) }
    );
  });
});

describe('saveFeedItem failures', () => {
  it.effect('SP-SAVE-6 saves nothing when the fetch fails', () =>
    run(
      Effect.gen(function* () {
        const item = yield* storeFeedItem(alice);
        const error = yield* saveFeedItem(alice, item.id).pipe(Effect.flip);

        expect(error._tag).toBe('WebpageFetcherError');
        expect(yield* storedPages(alice)).toEqual([]);
      }),
      {
        fetch: () => Effect.fail(new WebpageFetcherError({ message: 'fetch' })),
      }
    )
  );
});

describe('saveFeedItem races and deletion', () => {
  it.effect('SP-SAVE-10 saves the item found before it was deleted', () =>
    run(
      Effect.gen(function* () {
        const items = yield* FeedItemRepository;
        const item = yield* storeFeedItem(alice, {
          content: decodeContent('<p>Feed body</p>'),
        });
        const removingFind: IFeedItemRepository = {
          ...items,
          find: (owner, id) =>
            Effect.tap(items.find(owner, id), () => items.remove(owner, [id])),
        };

        const page = yield* saveFeedItem(alice, item.id).pipe(
          Effect.provideService(FeedItemRepository, removingFind)
        );

        expect(page.url.href).toBe(item.url.href);
        expect(page.content).toBe('<p>Feed body</p>');
        expect(Option.isNone(yield* items.find(alice, item.id))).toBe(true);
        expect(yield* storedPages(alice)).toEqual([page]);
      })
    )
  );
});

describe('saveFeedItem concurrent duplicates', () => {
  it.effect('SP-SAVE-7 the unique key saves one page and fails the other', () =>
    Effect.gen(function* () {
      const arrivals = yield* Ref.make(0);
      const gate = yield* Deferred.make<void>();

      const result = yield* run(
        Effect.gen(function* () {
          const item = yield* storeFeedItem(alice);
          const save = Effect.result(saveFeedItem(alice, item.id));
          const outcomes = yield* Effect.all([save, save], {
            concurrency: 'unbounded',
          });

          return { item, outcomes, pages: yield* storedPages(alice) };
        }),
        {
          fetch: () =>
            Effect.gen(function* () {
              const arrival = yield* Ref.updateAndGet(
                arrivals,
                (value) => value + 1
              );

              if (arrival === 2) {
                yield* Deferred.succeed(gate, void 0);
              }

              yield* Deferred.await(gate);

              return '<p>Hello</p>';
            }),
        }
      );

      const saved = result.outcomes.flatMap((outcome) =>
        Result.isSuccess(outcome) ? [outcome.success] : []
      );
      const failed = result.outcomes.flatMap((outcome) =>
        Result.isFailure(outcome) ? [outcome.failure] : []
      );

      expect(yield* Ref.get(arrivals)).toBe(2);
      expect(saved).toHaveLength(1);
      expect(failed).toHaveLength(1);

      const duplicate = failed[0];

      if (duplicate === undefined) {
        throw new Error('expected one failed save');
      }

      expect(asAlreadyExists(duplicate).url.href).toBe(result.item.url.href);
      expect(result.pages).toStrictEqual(saved);
    })
  );
});
