import { type DateTime, Effect, Option } from 'effect';
import type {
  ArticleContent,
  ArticleDescription,
  ArticleTitle,
} from '../../entity/common/article';
import type { NormalizedUrl } from '../../entity/common/normalized-url';
import {
  ArticleEmptyContent,
  type ArticleExtractorError,
  type HtmlParserError,
  type WebpageFetcherError,
} from '../../error/common';
import type { SettingRepositoryError } from '../../error/setting';
import { ArticleExtractor } from '../../port/article-extractor';
import { HtmlParser } from '../../port/html-parser';
import { WebpageFetcher } from '../../port/webpage-fetcher';

/** The article of one page, with content that is not empty (CM-FETCH step 5). */
export type FetchedArticle = {
  readonly title: ArticleTitle;
  readonly description: Option.Option<ArticleDescription>;
  readonly content: ArticleContent;
  readonly publishedAt: Option.Option<DateTime.Utc>;
};

/** Everything one fetch and extract can fail with (CM-FETCH-4). */
export type FetchAndExtractError =
  | WebpageFetcherError
  | SettingRepositoryError
  | HtmlParserError
  | ArticleExtractorError
  | ArticleEmptyContent;

/** The ports one fetch and extract runs on (CM-FETCH steps 1 to 3). */
export type FetchAndExtractPorts =
  | WebpageFetcher
  | HtmlParser
  | ArticleExtractor;

/**
 * Parses and extracts one fetched page inside the caller's resource scope, so
 * the parsed document lives exactly as long as this step (CM-FETCH step 2).
 * The extractor's description and content are already sanitized (CM-FETCH-3);
 * empty content fails (CM-FETCH step 4) and a missing publish time stays none
 * (CM-FETCH-1).
 */
const extractArticle = Effect.fnUntraced(function* (
  html: string,
  url: NormalizedUrl
) {
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

/**
 * Fetches one page and extracts its article (CM-FETCH): the fetcher is the one
 * the application picked from the owner's setting (CM-FETCH-2), the page is
 * parsed against the URL that resolves its relative links, and the result is
 * the title, the sanitized description and content, and the publish time as an
 * option. Nothing is stored here.
 */
export const fetchAndExtract = Effect.fn('fetchAndExtract')(function* (
  url: NormalizedUrl
) {
  const fetcher = yield* WebpageFetcher;
  const html = yield* fetcher.fetch(url.href);

  return yield* Effect.scoped(extractArticle(html, url));
});
