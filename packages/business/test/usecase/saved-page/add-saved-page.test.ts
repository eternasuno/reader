import { describe, expect, it } from '@effect/vitest';
import { DateTime, Deferred, Effect, Option, Ref, Result } from 'effect';
import { HtmlParserError } from '../../../src/port/html-parser';
import { SavedPageRepository } from '../../../src/port/saved-page-repository';
import { WebpageFetcherError } from '../../../src/port/webpage-fetcher';
import { addSavedPage } from '../../../src/usecase/saved-page/add-saved-page';
import { alice, decodeUrl, makeSavedPage } from '../../support/fixtures';
import {
  asAlreadyExists,
  fetchedArticle,
  recordingFetch,
  run,
  storedPages,
} from '../../support/usecase/saved-page';

const publishedAt = DateTime.fromDateUnsafe(
  new Date('2026-02-01T00:00:00.000Z')
);

describe('addSavedPage', () => {
  it.effect(
    'SP-ADD-2 saves the submitted normalized url and the article',
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
          expect(yield* storedPages(alice)).toEqual([page]);
        }),
        { fetch: recordingFetch(fetched) }
      );
    }
  );
});

describe('addSavedPage duplicates', () => {
  it.effect('SP-ADD-1 detects a duplicate before fetching', () => {
    const fetched: Array<string> = [];

    return run(
      Effect.gen(function* () {
        const repository = yield* SavedPageRepository;
        const url = decodeUrl('https://example.com/saved');
        const saved = makeSavedPage({ url });
        const callerUrl = decodeUrl('https://example.com/saved?utm_campaign=x');

        yield* repository.create(alice, [saved]);

        const error = yield* addSavedPage(alice, callerUrl).pipe(Effect.flip);

        expect(asAlreadyExists(error).url.href).toBe(url.href);
        expect(fetched).toEqual([]);
        expect(yield* storedPages(alice)).toEqual([saved]);
      }),
      { fetch: recordingFetch(fetched) }
    );
  });
});

describe('addSavedPage publish time', () => {
  it.effect('SP-ADD-4 keeps the publish time reported by the extraction', () =>
    run(
      Effect.gen(function* () {
        const url = decodeUrl('https://example.com/published');
        const page = yield* addSavedPage(alice, url);

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
});

describe('addSavedPage failures', () => {
  it.effect('SP-ADD-3 saves nothing when the fetch fails', () =>
    run(
      Effect.gen(function* () {
        const url = decodeUrl('https://example.com/broken');
        const error = yield* addSavedPage(alice, url).pipe(Effect.flip);

        expect(error._tag).toBe('WebpageFetcherError');
        expect(yield* storedPages(alice)).toEqual([]);
      }),
      {
        fetch: () => Effect.fail(new WebpageFetcherError({ message: 'fetch' })),
      }
    )
  );

  it.effect('SP-ADD-3 saves nothing when parsing fails', () =>
    run(
      Effect.gen(function* () {
        const url = decodeUrl('https://example.com/unparsable');
        const error = yield* addSavedPage(alice, url).pipe(Effect.flip);

        expect(error._tag).toBe('HtmlParserError');
        expect(yield* storedPages(alice)).toEqual([]);
      }),
      {
        parse: () => Effect.fail(new HtmlParserError({ message: 'parse' })),
      }
    )
  );

  it.effect('SP-ADD-3 saves nothing when the extracted content is empty', () =>
    run(
      Effect.gen(function* () {
        const url = decodeUrl('https://example.com/empty');
        const error = yield* addSavedPage(alice, url).pipe(Effect.flip);

        expect(error._tag).toBe('ArticleEmptyContent');
        expect(yield* storedPages(alice)).toEqual([]);
      }),
      {
        extract: () =>
          Effect.succeed(fetchedArticle({ content: Option.none() })),
      }
    )
  );
});

describe('addSavedPage concurrent duplicates', () => {
  it.effect('SP-ADD-5 the unique key saves one page and fails the other', () =>
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

          return { outcomes, pages: yield* storedPages(alice) };
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
        throw new Error('expected one failed add');
      }

      expect(asAlreadyExists(duplicate).url.href).toBe(url.href);
      expect(result.pages).toStrictEqual(saved);
    })
  );
});
