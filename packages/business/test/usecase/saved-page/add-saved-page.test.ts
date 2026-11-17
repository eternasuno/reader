import { describe, expect, it } from '@effect/vitest';
import { DateTime, Deferred, Effect, Option, Ref, Result } from 'effect';
import { WebpageFetcherError } from '../../../src/error/common';
import { SavedPageRepository } from '../../../src/port/saved-page-repository';
import { addSavedPage } from '../../../src/usecase/saved-page/add-saved-page';
import { alice, decodeUrl, makeSavedPage } from '../../support/fixtures';
import { fetchedArticle } from '../common/harness';
import { asAlreadyExists, run, storedPages } from './harness';

const publishedAt = DateTime.fromDateUnsafe(
  new Date('2026-02-01T00:00:00.000Z')
);

describe('addSavedPage', () => {
  it.effect(
    'SP-ADD-2 saves the submitted url and the extracted article',
    () => {
      const fetched: Array<string> = [];

      return run(
        Effect.gen(function* () {
          const url = decodeUrl('https://example.com/post?utm_source=news#top');
          const page = yield* addSavedPage(alice, url);

          expect(page.url.href).toBe('https://example.com/post');
          expect(page.ownerId).toBe(alice);
          expect(page.title).toBe('Fetched');
          expect(Option.getOrThrow(page.description)).toBe(
            'Fetched description'
          );
          expect(page.content).toBe('<p>Fetched</p>');
          expect(page.read).toBe(false);
          expect(fetched).toEqual([url.href]);
          expect(yield* storedPages()).toStrictEqual([page]);
        }),
        {
          fetch: (href) => {
            fetched.push(href);

            return Effect.succeed('<html><body>page</body></html>');
          },
        }
      );
    }
  );
});

describe('addSavedPage publish time', () => {
  it.effect('SP-ADD-4 keeps the publish time the extraction reports', () =>
    run(
      Effect.gen(function* () {
        const page = yield* addSavedPage(
          alice,
          decodeUrl('https://example.com/dated')
        );

        expect(Option.getOrThrow(page.publishedAt)).toBe(publishedAt);
      }),
      {
        extract: () =>
          Effect.succeed(
            fetchedArticle({ publishedAt: Option.some(publishedAt) })
          ),
      }
    )
  );

  it.effect('SP-ADD-4 stores no publish time when the page has none', () =>
    run(
      Effect.gen(function* () {
        const page = yield* addSavedPage(
          alice,
          decodeUrl('https://example.com/undated')
        );

        expect(Option.isNone(page.publishedAt)).toBe(true);
      })
    )
  );
});

describe('addSavedPage duplicates', () => {
  it.effect('SP-ADD-1 detects a duplicate before fetching', () => {
    const fetched: Array<string> = [];

    return run(
      Effect.gen(function* () {
        const pages = yield* SavedPageRepository;
        const url = decodeUrl('https://example.com/saved');
        const saved = makeSavedPage({ url });

        yield* pages.create(alice, [saved]);

        const error = yield* addSavedPage(
          alice,
          decodeUrl('https://example.com/saved?utm_campaign=x')
        ).pipe(Effect.flip);

        expect(asAlreadyExists(error).url.href).toBe(url.href);
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

describe('addSavedPage failures', () => {
  it.effect('SP-ADD-3 saves nothing when the page cannot be fetched', () =>
    run(
      Effect.gen(function* () {
        const error = yield* addSavedPage(
          alice,
          decodeUrl('https://example.com/broken')
        ).pipe(Effect.flip);

        expect(error._tag).toBe('WebpageFetcherError');
        expect(yield* storedPages()).toStrictEqual([]);
      }),
      {
        fetch: () => Effect.fail(new WebpageFetcherError({ message: 'fetch' })),
      }
    )
  );

  it.effect('SP-ADD-3 saves nothing when the extracted content is empty', () =>
    run(
      Effect.gen(function* () {
        const error = yield* addSavedPage(
          alice,
          decodeUrl('https://example.com/empty')
        ).pipe(Effect.flip);

        expect(error._tag).toBe('ArticleEmptyContent');
        expect(yield* storedPages()).toStrictEqual([]);
      }),
      {
        extract: () =>
          Effect.succeed(fetchedArticle({ content: Option.none() })),
      }
    )
  );
});

describe('addSavedPage concurrent duplicates', () => {
  it.effect('SP-ADD-5 the unique url saves exactly one page', () =>
    Effect.gen(function* () {
      const arrivals = yield* Ref.make(0);
      const gate = yield* Deferred.make<void>();
      const url = decodeUrl('https://example.com/concurrent');

      const result = yield* run(
        Effect.gen(function* () {
          const outcomes = yield* Effect.all(
            [
              Effect.result(addSavedPage(alice, url)),
              Effect.result(addSavedPage(alice, url)),
            ],
            { concurrency: 'unbounded' }
          );

          return { outcomes, pages: yield* storedPages() };
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

              return '<html><body>page</body></html>';
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
      expect(result.pages).toStrictEqual(saved);
      expect(failed).toHaveLength(1);
      expect(asAlreadyExists(failed[0] ?? { _tag: 'none' }).url.href).toBe(
        url.href
      );
    })
  );
});
