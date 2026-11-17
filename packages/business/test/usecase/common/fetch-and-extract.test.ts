import { describe, expect, it } from '@effect/vitest';
import { DateTime, Effect, Option, Ref } from 'effect';
import {
  ArticleExtractorError,
  HtmlParserError,
  WebpageFetcherError,
} from '../../../src/error/common';
import { fetchAndExtract } from '../../../src/usecase/common/fetch-and-extract';
import { decodeUrl } from '../../support/fixtures';
import { fetchedArticle, parsedDocument, runWithFetch } from './harness';

const url = decodeUrl('https://example.com/article');

const pageHtml = '<html><body><p>Hello</p></body></html>';

const publishedAt = DateTime.fromDateUnsafe(
  new Date('2026-02-01T00:00:00.000Z')
);

describe('fetchAndExtract', () => {
  it.effect('CM-FETCH fetches the page and parses it against the url', () =>
    Effect.gen(function* () {
      const fetched: Array<string> = [];
      const parsed: Array<readonly [string, string]> = [];
      const article = yield* runWithFetch(fetchAndExtract(url), {
        fetch: (href) => {
          fetched.push(href);

          return Effect.succeed(pageHtml);
        },
        parse: (html, base) => {
          parsed.push([html, base.href]);

          return Effect.succeed(parsedDocument(html));
        },
      });

      expect(fetched).toEqual([url.href]);
      expect(parsed).toEqual([[pageHtml, url.href]]);
      expect(article.title).toBe('Fetched');
      expect(Option.getOrThrow(article.description)).toBe(
        'Fetched description'
      );
      expect(article.content).toBe('<p>Fetched</p>');
    })
  );

  it.effect('CM-FETCH keeps the publish time the extractor reports', () =>
    Effect.gen(function* () {
      const article = yield* runWithFetch(fetchAndExtract(url), {
        extract: () =>
          Effect.succeed(
            fetchedArticle({ publishedAt: Option.some(publishedAt) })
          ),
      });

      expect(Option.getOrThrow(article.publishedAt)).toBe(publishedAt);
    })
  );

  it.effect('CM-FETCH-1 keeps a missing publish time as none', () =>
    Effect.gen(function* () {
      const article = yield* runWithFetch(fetchAndExtract(url));

      expect(Option.isNone(article.publishedAt)).toBe(true);
    })
  );
});

describe('fetchAndExtract failures', () => {
  it.effect('CM-FETCH-4 fails when the extracted content is empty', () =>
    Effect.gen(function* () {
      const error = yield* runWithFetch(fetchAndExtract(url), {
        extract: () =>
          Effect.succeed(fetchedArticle({ content: Option.none() })),
      }).pipe(Effect.flip);

      expect(error._tag).toBe('ArticleEmptyContent');
    })
  );

  it.effect('CM-FETCH-4 propagates the fetch, parse and extract failures', () =>
    Effect.gen(function* () {
      const fetchError = yield* runWithFetch(fetchAndExtract(url), {
        fetch: () => Effect.fail(new WebpageFetcherError({ message: 'fetch' })),
      }).pipe(Effect.flip);

      expect(fetchError._tag).toBe('WebpageFetcherError');

      const parseError = yield* runWithFetch(fetchAndExtract(url), {
        parse: () => Effect.fail(new HtmlParserError({ message: 'parse' })),
      }).pipe(Effect.flip);

      expect(parseError._tag).toBe('HtmlParserError');

      const extractError = yield* runWithFetch(fetchAndExtract(url), {
        extract: () =>
          Effect.fail(new ArticleExtractorError({ message: 'extract' })),
      }).pipe(Effect.flip);

      expect(extractError._tag).toBe('ArticleExtractorError');
    })
  );
});

describe('fetchAndExtract resource scope', () => {
  it.effect('CM-FETCH releases the parsed document before returning', () =>
    Effect.gen(function* () {
      const released = yield* Ref.make(false);

      yield* runWithFetch(fetchAndExtract(url), {
        parse: () =>
          Effect.acquireRelease(Effect.succeed(parsedDocument(pageHtml)), () =>
            Ref.set(released, true)
          ),
      });

      expect(yield* Ref.get(released)).toBe(true);
    })
  );
});
