import { type DateTime, Effect, Option } from 'effect';
import type {
  ArticleContent,
  ArticleDescription,
  ArticleTitle,
} from '../../entity/common/article';
import type { NormalizedUrl } from '../../entity/common/normalized-url';
import {
  ArticleExtractor,
  type ArticleExtractorError,
} from '../../port/article-extractor';
import { HtmlParser, type HtmlParserError } from '../../port/html-parser';
import {
  WebpageFetcher,
  type WebpageFetcherError,
} from '../../port/webpage-fetcher';
import { ArticleEmptyContent } from './errors';

export type FetchedArticle = {
  readonly title: ArticleTitle;
  readonly description: Option.Option<ArticleDescription>;
  readonly content: ArticleContent;
  readonly publishedAt: Option.Option<DateTime.Utc>;
};

const extractArticle = (html: string, url: NormalizedUrl) =>
  Effect.gen(function* () {
    const parser = yield* HtmlParser;
    const extractor = yield* ArticleExtractor;
    const document = yield* parser.parse(html, url);
    const article = yield* extractor.extract(document);

    if (Option.isNone(article.content)) {
      return yield* new ArticleEmptyContent();
    }

    return {
      title: article.title,
      description: article.description,
      content: article.content.value,
      publishedAt: article.publishedAt,
    } satisfies FetchedArticle;
  });

export const fetchAndExtract = (
  url: NormalizedUrl
): Effect.Effect<
  FetchedArticle,
  | WebpageFetcherError
  | HtmlParserError
  | ArticleExtractorError
  | ArticleEmptyContent,
  WebpageFetcher | HtmlParser | ArticleExtractor
> =>
  Effect.gen(function* () {
    const fetcher = yield* WebpageFetcher;
    const html = yield* fetcher.fetch(url.href);

    return yield* Effect.scoped(extractArticle(html, url));
  });
