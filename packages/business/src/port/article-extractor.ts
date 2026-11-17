import { Context, type Effect } from 'effect';
import type { ExtractedArticle } from '../entity/common/article';
import type { ArticleExtractorError } from '../error/common';
import type { HtmlDocument } from './html-parser';

/** Extracts one article from a parsed document (CM-FETCH step 3). */
export interface IArticleExtractor {
  /**
   * The title, description, content and publish time of the article in the
   * document, with the description and content already sanitized: sanitizing is
   * part of this port's contract, not a step of the use case (CM-FETCH-3,
   * CM-ART-4). A missing publish time is none and nobody invents one
   * (CM-FETCH-1); empty content is none here (CM-ART-5) and becomes
   * `ArticleEmptyContent` in the use case. The adapter decodes its own output
   * into `ExtractedArticle`; that is its boundary.
   */
  readonly extract: (
    document: HtmlDocument
  ) => Effect.Effect<ExtractedArticle, ArticleExtractorError>;
}

export class ArticleExtractor extends Context.Service<
  ArticleExtractor,
  IArticleExtractor
>()('@reader/business/ArticleExtractor') {}
