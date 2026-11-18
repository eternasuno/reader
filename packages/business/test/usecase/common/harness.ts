import type { DateTime } from 'effect';
import { Effect, Layer, Option } from 'effect';
import {
  ArticleContent,
  ArticleDescription,
  ArticleTitle,
  type ExtractedArticle,
} from '../../../src/entity/common/article';
import type { IArticleExtractor } from '../../../src/port/article-extractor';
import { ArticleExtractor } from '../../../src/port/article-extractor';
import type { HtmlDocument, IHtmlParser } from '../../../src/port/html-parser';
import { HtmlParser } from '../../../src/port/html-parser';
import type { IWebpageFetcher } from '../../../src/port/webpage-fetcher';
import { WebpageFetcher } from '../../../src/port/webpage-fetcher';

export const pageHtml = '<html><body><p>Page</p></body></html>';

/**
 * The parsed page a test double returns. Business treats `HtmlDocument` as
 * opaque, so the double stands in for whatever the content adapter parses.
 */
export const parsedDocument = (html: string): HtmlDocument =>
  ({ html }) as unknown as HtmlDocument;

export type ArticleOverrides = {
  readonly title?: ArticleTitle;
  readonly description?: Option.Option<ArticleDescription>;
  readonly content?: Option.Option<ArticleContent>;
  readonly publishedAt?: Option.Option<DateTime.Utc>;
};

/** What the mocked extractor returns (CM-FETCH step 3). */
export const fetchedArticle = (
  overrides: ArticleOverrides = {}
): ExtractedArticle => ({
  title: ArticleTitle.make('Fetched'),
  description: Option.some(ArticleDescription.make('Fetched description')),
  content: Option.some(ArticleContent.make('<p>Fetched</p>')),
  publishedAt: Option.none(),
  ...overrides,
});

/** The extraction doubles one test replaces; everything else succeeds. */
export type FetchDoubles = {
  readonly fetch?: IWebpageFetcher['fetch'];
  readonly parse?: IHtmlParser['parse'];
  readonly extract?: IArticleExtractor['extract'];
};

/** The ports one fetch and extract requires (CM-FETCH). */
export type FetchServices = WebpageFetcher | HtmlParser | ArticleExtractor;

export const fetchLayers = (
  doubles: FetchDoubles = {}
): Layer.Layer<FetchServices> =>
  Layer.mergeAll(
    Layer.mock(WebpageFetcher, {
      fetch: doubles.fetch ?? (() => Effect.succeed(pageHtml)),
    }),
    Layer.mock(HtmlParser, {
      parse: doubles.parse ?? (() => Effect.succeed(parsedDocument(pageHtml))),
    }),
    Layer.mock(ArticleExtractor, {
      extract: doubles.extract ?? (() => Effect.succeed(fetchedArticle())),
    })
  );

export const runWithFetch = <A, E>(
  effect: Effect.Effect<A, E, FetchServices>,
  doubles: FetchDoubles = {}
): Effect.Effect<A, E> => effect.pipe(Effect.provide(fetchLayers(doubles)));
