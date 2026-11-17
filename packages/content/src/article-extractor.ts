import { Readability } from '@mozilla/readability';
import {
  ArticleExtractor,
  ArticleExtractorError,
  ExtractedArticle,
  type HtmlDocument,
} from '@reader/business';
import { DateTime, Effect, Layer, Option, Schema } from 'effect';
import { documentOf } from './html-parser';
import { sanitizeHtml, sanitizeText } from './sanitize';

const decodeArticle = Schema.decodeSync(ExtractedArticle);

/** Readability rearranges the document it reads, so it reads a clone. */
const cloneOf = (document: Document): Document =>
  document.cloneNode(true) as Document;

const descriptionOf = (
  document: Document,
  excerpt: string | null | undefined
): string | undefined =>
  excerpt === null || excerpt === undefined || excerpt.trim() === ''
    ? undefined
    : sanitizeText(document, excerpt.trim());

/** Nothing left after cleaning is none, which the use case reports (CM-ART-5). */
const contentOf = (
  document: Document,
  content: string | null | undefined
): string | undefined =>
  content === null || content === undefined
    ? undefined
    : sanitizeHtml(document, content);

/** The source's own time only; a missing or unparseable one is none (CM-FETCH-1). */
const publishedDateOf = (
  publishedTime: string | null | undefined
): Date | undefined =>
  Option.getOrUndefined(
    Option.map(
      Schema.decodeOption(Schema.DateTimeUtcFromString)(publishedTime ?? ''),
      DateTime.toDateUtc
    )
  );

const extractArticle = (document: Document): ExtractedArticle => {
  const article = new Readability(cloneOf(document)).parse();

  return decodeArticle({
    title: article?.title ?? document.title,
    description: descriptionOf(document, article?.excerpt),
    content: contentOf(document, article?.content),
    publishedAt: publishedDateOf(article?.publishedTime),
  });
};

export const extract = Effect.fn('ArticleExtractor.extract')(function* (
  document: HtmlDocument
) {
  return yield* Effect.try({
    try: () => extractArticle(documentOf(document)),
    catch: () =>
      new ArticleExtractorError({
        message: 'Unable to extract the article from the document',
      }),
  });
});

export const ArticleExtractorLive = Layer.succeed(ArticleExtractor, {
  extract,
});
