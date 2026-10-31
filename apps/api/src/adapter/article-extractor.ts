import { Readability } from '@mozilla/readability';
import { ArticleExtractError, ArticleExtractor } from '@reader/business';
import { Effect, Layer } from 'effect';
import { JSDOM } from 'jsdom';
import { cleanArticle } from '../infrastructure/article-sanitizer';

const extract = (html: string, url: string) => {
  const dom = new JSDOM(html, { url });
  try {
    const result = new Readability(dom.window.document, {
      maxElemsToParse: 50000,
    }).parse();
    if (!result?.content) {
      throw new Error('No article found');
    }

    cleanArticle(dom, result.content, url);

    return {
      title: result.title || url,
      html: dom.window.document.body.innerHTML,
    };
  } finally {
    dom.window.close();
  }
};

export const ArticleExtractorLive = Layer.succeed(ArticleExtractor, {
  extract: (html, url) =>
    Effect.try({
      try: () => extract(html, url),
      catch: () =>
        new ArticleExtractError({ error: '无法提取正文，请打开原文阅读' }),
    }),
});
