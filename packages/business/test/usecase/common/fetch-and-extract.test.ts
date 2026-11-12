import { describe, expect, it } from '@effect/vitest';
import { DateTime, Effect, Layer, Option, Ref } from 'effect';
import type {
  ArticleContent,
  ArticleDescription,
} from '../../../src/entity/common/article';
import {
  ArticleExtractor,
  ArticleExtractorError,
  type ExtractedArticle,
  type IArticleExtractor,
} from '../../../src/port/article-extractor';
import {
  HtmlParser,
  HtmlParserError,
  type IHtmlParser,
} from '../../../src/port/html-parser';
import {
  type IWebpageFetcher,
  WebpageFetcher,
  WebpageFetcherError,
} from '../../../src/port/webpage-fetcher';
import { fetchAndExtract } from '../../../src/usecase/common/fetch-and-extract';
import {
  decodeContent,
  decodeDescription,
  decodeTitle,
  decodeUrl,
  parsedDocument,
} from '../../support';

const url = decodeUrl('https://example.com/article');

const pageHtml = '<html><body><p>Hello</p></body></html>';

const document = parsedDocument('<p>Hello</p>');

const publishedAt = DateTime.fromDateUnsafe(
  new Date('2026-02-01T00:00:00.000Z')
);

type ExtractedOverrides = {
  readonly description?: Option.Option<ArticleDescription>;
  readonly content?: Option.Option<ArticleContent>;
  readonly publishedAt?: Option.Option<DateTime.Utc>;
};

const extracted = (overrides: ExtractedOverrides = {}): ExtractedArticle => ({
  title: decodeTitle('Title'),
  description: decodeDescription('Description'),
  content: decodeContent('<p>Body</p>'),
  publishedAt: Option.none(),
  ...overrides,
});

type Doubles = {
  readonly fetch?: IWebpageFetcher['fetch'];
  readonly parse?: IHtmlParser['parse'];
  readonly extract?: IArticleExtractor['extract'];
};

const testLayer = (doubles: Doubles) =>
  Layer.mergeAll(
    Layer.mock(WebpageFetcher, {
      fetch: doubles.fetch ?? (() => Effect.succeed(pageHtml)),
    }),
    Layer.mock(HtmlParser, {
      parse: doubles.parse ?? (() => Effect.succeed(document)),
    }),
    Layer.mock(ArticleExtractor, {
      extract: doubles.extract ?? (() => Effect.succeed(extracted())),
    })
  );

const run = <A, E>(
  effect: Effect.Effect<A, E, WebpageFetcher | HtmlParser | ArticleExtractor>,
  doubles: Doubles = {}
) => effect.pipe(Effect.provide(testLayer(doubles)));

describe('fetchAndExtract', () => {
  it.effect('fetches the page, parses it and returns the values', () =>
    Effect.gen(function* () {
      const fetched: Array<string> = [];
      const parsed: Array<readonly [string, string]> = [];
      const article = yield* run(fetchAndExtract(url), {
        fetch: (href) => {
          fetched.push(href);

          return Effect.succeed(pageHtml);
        },
        parse: (html, base) => {
          parsed.push([html, base.href]);

          return Effect.succeed(document);
        },
        extract: () =>
          Effect.succeed(extracted({ publishedAt: Option.some(publishedAt) })),
      });

      expect(article.title).toBe('Title');
      expect(Option.getOrThrow(article.description)).toBe('Description');
      expect(article.content).toBe('<p>Body</p>');
      expect(Option.getOrThrow(article.publishedAt)).toBe(publishedAt);
      expect(fetched).toEqual([url.href]);
      expect(parsed).toEqual([[pageHtml, url.href]]);
    })
  );

  it.effect('keeps a missing publish time as none', () =>
    Effect.gen(function* () {
      const article = yield* run(fetchAndExtract(url));

      expect(Option.isNone(article.publishedAt)).toBe(true);
    })
  );
});

describe('fetchAndExtract failures', () => {
  it.effect('fails when the extracted content is empty', () =>
    Effect.gen(function* () {
      const error = yield* run(fetchAndExtract(url), {
        extract: () => Effect.succeed(extracted({ content: Option.none() })),
      }).pipe(Effect.flip);

      expect(error._tag).toBe('ArticleEmptyContent');
    })
  );

  it.effect('propagates fetch, parse and extract errors', () =>
    Effect.gen(function* () {
      const fetchError = yield* run(fetchAndExtract(url), {
        fetch: () => Effect.fail(new WebpageFetcherError({ message: 'fetch' })),
      }).pipe(Effect.flip);

      expect(fetchError._tag).toBe('WebpageFetcherError');
      expect(fetchError.message).toBe('fetch');

      const parseError = yield* run(fetchAndExtract(url), {
        parse: () => Effect.fail(new HtmlParserError({ message: 'parse' })),
      }).pipe(Effect.flip);

      expect(parseError._tag).toBe('HtmlParserError');
      expect(parseError.message).toBe('parse');

      const extractError = yield* run(fetchAndExtract(url), {
        extract: () =>
          Effect.fail(new ArticleExtractorError({ message: 'extract' })),
      }).pipe(Effect.flip);

      expect(extractError._tag).toBe('ArticleExtractorError');
      expect(extractError.message).toBe('extract');
    })
  );
});

describe('fetchAndExtract resource scope', () => {
  it.effect('releases the parsed document before returning', () =>
    Effect.gen(function* () {
      const released = yield* Ref.make(false);

      yield* run(fetchAndExtract(url), {
        parse: () =>
          Effect.acquireRelease(Effect.succeed(document), () =>
            Ref.set(released, true)
          ),
      });

      expect(yield* Ref.get(released)).toBe(true);
    })
  );
});
