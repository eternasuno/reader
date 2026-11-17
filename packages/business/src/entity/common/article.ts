import { Schema, SchemaTransformation } from 'effect';
import { OptionFromOptionalNonEmpty } from './optional';

/**
 * An article title: trimmed, and empty becomes "Untitled" (CM-ART-1).
 */
export const ArticleTitle = Schema.Trim.pipe(
  Schema.decode(
    SchemaTransformation.transform({
      decode: (title) => title || 'Untitled',
      encode: (title) => title,
    })
  ),
  Schema.brand('ArticleTitle')
);

export type ArticleTitle = typeof ArticleTitle.Type;

/** Trimmed (CM-ART-2). */
export const ArticleDescription = Schema.Trim.pipe(
  Schema.brand('ArticleDescription')
);

export type ArticleDescription = typeof ArticleDescription.Type;

/**
 * Trimmed (CM-ART-2). A stored description or content is always sanitized
 * HTML; only the cleaning step of the refresh and the article extractor store
 * it (CM-ART-4).
 */
export const ArticleContent = Schema.Trim.pipe(Schema.brand('ArticleContent'));

export type ArticleContent = typeof ArticleContent.Type;

/**
 * What `ArticleExtractor` returns for one parsed document: the title, an
 * optional description and content, and the publish time as none when the page
 * has none (CM-FETCH step 3, CM-FETCH-1). The adapter sanitizes the description
 * and content and decodes its own output into this struct (CM-FETCH-3,
 * CM-ART-4).
 */
export const ExtractedArticle = Schema.Struct({
  title: ArticleTitle,
  description: OptionFromOptionalNonEmpty(ArticleDescription),
  content: OptionFromOptionalNonEmpty(ArticleContent),
  publishedAt: Schema.OptionFromOptional(Schema.DateTimeUtcFromDate),
});

export type ExtractedArticle = typeof ExtractedArticle.Type;
