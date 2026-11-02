import { Readability } from '@mozilla/readability';
import { ArticleExtractError, ArticleExtractor } from '@reader/business';
import { Effect, Layer, Option, Schema } from 'effect';
import { cleanArticle } from '../infrastructure/article-sanitizer';

const UNTITLED = 'Untitled';

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
) => {
  const text = excerpt?.trim();
  if (text === undefined || text === '') {
    return {};
  }

  return { description: escapeText(document, text) };
};

const publishedAtOf = (publishedTime: string | null | undefined) => {
  const publishedAt = decodePublishedAt(publishedTime ?? '');

  return Option.isSome(publishedAt) ? { publishedAt: publishedAt.value } : {};
};

const readArticle = (document: Document) => {
  const result = new Readability(document, {
    maxElemsToParse: 50_000,
  }).parse();
  if (!result?.content) {
    throw new Error('No article content found');
  }

  cleanArticle(document, result.content);

  return {
    title: result.title?.trim() || UNTITLED,
    content: document.body.innerHTML,
    ...descriptionOf(document, result.excerpt),
    ...publishedAtOf(result.publishedTime),
  };
};

export const ArticleExtractorLive = Layer.succeed(ArticleExtractor, {
  extract: (document) =>
    Effect.try({
      try: () => readArticle(document),
      catch: () =>
        new ArticleExtractError({
          error: 'Unable to extract article content; open the original page',
        }),
    }),
});
