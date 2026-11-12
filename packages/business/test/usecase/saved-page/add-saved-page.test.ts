import { describe, expect, it } from '@effect/vitest';
import { DateTime, Effect, Option } from 'effect';
import { HtmlParserError } from '../../../src/port/html-parser';
import { SavedPageRepository } from '../../../src/port/saved-page-repository';
import { WebpageFetcherError } from '../../../src/port/webpage-fetcher';
import { addSavedPage } from '../../../src/usecase/saved-page/add-saved-page';
import { alice, bob, decodeUrl, makeSavedPage } from '../../support';
import {
  asAlreadyExists,
  capture,
  errorsOf,
  fetchedArticle,
  recordingFetch,
  run,
  storedPages,
} from './support';

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

  it.effect('SP-ADD-5 saves exactly one page when two adds run at once', () => {
    const fetched: Array<string> = [];

    return run(
      Effect.gen(function* () {
        const url = decodeUrl('https://example.com/race');
        const captures = yield* Effect.all(
          [
            capture(addSavedPage(alice, url)),
            capture(addSavedPage(alice, url)),
          ],
          { concurrency: 'unbounded' }
        );

        expect(captures.filter((captured) => captured.ok)).toHaveLength(1);
        expect(errorsOf(captures).map((error) => error._tag)).toEqual([
          'SavedPageAlreadyExists',
        ]);
        expect(fetched).toHaveLength(2);
        expect(yield* storedPages(alice)).toHaveLength(1);
      }),
      {
        fetch: (href) => {
          fetched.push(href);

          return Effect.as(
            Effect.yieldNow,
            '<html><body><p>Raced</p></body></html>'
          );
        },
      }
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

describe('addSavedPage ownership', () => {
  it.effect('SP-ID-2 saves the same url for two owners as two pages', () =>
    run(
      Effect.gen(function* () {
        const url = decodeUrl('https://example.com/shared');
        const mine = yield* addSavedPage(alice, url);
        const theirs = yield* addSavedPage(bob, url);

        expect(theirs.id).not.toBe(mine.id);
        expect(yield* storedPages(alice)).toEqual([mine]);
        expect(yield* storedPages(bob)).toEqual([theirs]);
      })
    )
  );

  it.effect("SP-OWN-1 does not treat another owner's page as a duplicate", () =>
    run(
      Effect.gen(function* () {
        const repository = yield* SavedPageRepository;
        const url = decodeUrl('https://example.com/foreign');
        const theirs = makeSavedPage({ ownerId: bob, url });

        yield* repository.create(bob, [theirs]);

        const mine = yield* addSavedPage(alice, url);

        expect(mine.ownerId).toBe(alice);
        expect(yield* storedPages(alice)).toEqual([mine]);
        expect(yield* storedPages(bob)).toEqual([theirs]);
      })
    )
  );
});
