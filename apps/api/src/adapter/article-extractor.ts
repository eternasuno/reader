import { Readability } from '@mozilla/readability';
import { ArticleExtractError, ArticleExtractor } from '@reader/business';
import { Effect, Layer, Option, Schema } from 'effect';
import { JSDOM } from 'jsdom';
import { cleanArticle } from '../infrastructure/article-sanitizer';

const UNTITLED = 'Untitled';

const decodePublishedAt = Schema.decodeUnknownOption(
  Schema.DateTimeUtcFromString
);

const acquireDom = (html: string, url: string) =>
  Effect.acquireRelease(
    Effect.sync(() => new JSDOM(html, { url })),
    (dom) => Effect.sync(() => dom.window.close())
  );

const escapeText = (dom: JSDOM, value: string): string => {
  const element = dom.window.document.createElement('span');
  element.textContent = value;

  return element.innerHTML;
};

const descriptionOf = (dom: JSDOM, excerpt: string | null | undefined) => {
  const text = excerpt?.trim();
  if (text === undefined || text === '') {
    return {};
  }

  return { description: escapeText(dom, text) };
};

const publishedAtOf = (publishedTime: string | null | undefined) => {
  const publishedAt = decodePublishedAt(publishedTime ?? '');

  return Option.isSome(publishedAt) ? { publishedAt: publishedAt.value } : {};
};

const readArticle = (dom: JSDOM, url: string) => {
  const result = new Readability(dom.window.document, {
    maxElemsToParse: 50000,
  }).parse();
  if (!result?.content) {
    throw new Error('No article content found');
  }

  cleanArticle(dom, result.content, url);

  return {
    title: result.title?.trim() || UNTITLED,
    html: dom.window.document.body.innerHTML,
    ...descriptionOf(dom, result.excerpt),
    ...publishedAtOf(result.publishedTime),
  };
};

const parseDom = (dom: JSDOM, url: string) =>
  Effect.try({
    try: () => readArticle(dom, url),
    catch: () =>
      new ArticleExtractError({
        error: 'Unable to extract article content; open the original page',
      }),
  });

export const ArticleExtractorLive = Layer.succeed(ArticleExtractor, {
  extract: (html, url) =>
    Effect.gen(function* () {
      const dom = yield* acquireDom(html, url);

      return yield* parseDom(dom, url);
    }).pipe(Effect.scoped),
});
