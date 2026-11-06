import { Readability } from '@mozilla/readability';
import {
  ArticleExtractor,
  ArticleExtractorError,
  ExtractedArticle,
} from '@reader/business';
import { DateTime, Effect, Layer, Option, Schema } from 'effect';
import { cleanArticle } from '../infrastructure/article-sanitizer';

const decodePublishedAt = Schema.decodeUnknownOption(
  Schema.DateTimeUtcFromString
);

const escapeText = (document: Document, value: string): string => {
  const element = document.createElement('span');
  element.textContent = value;

  return element.innerHTML;
};

const descriptionOf = (
  document: Document,
  excerpt: string | null | undefined
): Option.Option<string> => {
  const text = excerpt?.trim();
  if (text === undefined || text === '') {
    return Option.none();
  }

  return Option.some(escapeText(document, text));
};

const publishedAtOf = (
  publishedTime: string | null | undefined,
  now: DateTime.Utc
): DateTime.Utc => {
  const publishedAt = decodePublishedAt(publishedTime ?? '');

  return Option.isSome(publishedAt) ? publishedAt.value : now;
};

const readArticle = (
  document: Document,
  now: DateTime.Utc
): ExtractedArticle => {
  const result = new Readability(document, {
    maxElemsToParse: 50_000,
  }).parse();
  if (!result?.content) {
    throw new Error('No article content found');
  }

  cleanArticle(document, result.content);

  return Schema.decodeSync(ExtractedArticle)({
    title: result.title ?? '',
    description: Option.getOrUndefined(descriptionOf(document, result.excerpt)),
    content: document.body.innerHTML,
    publishedAt: DateTime.toDateUtc(publishedAtOf(result.publishedTime, now)),
  });
};

export const ArticleExtractorLive = Layer.succeed(ArticleExtractor, {
  extract: (document) =>
    Effect.flatMap(DateTime.now, (now) =>
      Effect.try({
        try: () => readArticle(document, now),
        catch: () =>
          new ArticleExtractorError({
            message:
              'Unable to extract article content; open the original page',
          }),
      })
    ),
});
