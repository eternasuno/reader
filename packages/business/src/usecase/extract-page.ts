import { Data, Effect, Option } from 'effect';
import { ArticleExtractor } from '../port/article-extractor';
import { HtmlParser } from '../port/html-parser';
import { WebpageFetcher } from '../port/webpage-fetcher';

export class ArticleEmptyContent extends Data.TaggedError(
  'ArticleEmptyContent'
)<{
  readonly message: string;
}> {}

export const fetchAndExtract = (sourceUrl: URL) =>
  Effect.gen(function* () {
    const fetcher = yield* WebpageFetcher;
    const html = yield* fetcher.fetch(sourceUrl.href);
    const parser = yield* HtmlParser;
    const document = yield* parser.parse(html, sourceUrl);
    const extractor = yield* ArticleExtractor;
    const extracted = yield* extractor.extract(document);
    if (Option.isNone(extracted.content)) {
      return yield* new ArticleEmptyContent({
        message: 'Article content is empty',
      });
    }

    return { ...extracted, content: extracted.content.value };
  }).pipe(Effect.scoped);
