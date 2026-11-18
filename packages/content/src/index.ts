import { Layer } from 'effect';
import { ArticleExtractorLive } from './article-extractor';
import { DocumentSanitizerLive } from './document-sanitizer';
import { FeedParserLive } from './feed-parser';
import { HtmlParserLive } from './html-parser';

export { ArticleExtractorLive } from './article-extractor';
export { DocumentSanitizerLive } from './document-sanitizer';
export { FeedParserLive } from './feed-parser';
export { HtmlParserLive } from './html-parser';

/** The content adapters, provided once by the application. */
export const ContentLive = Layer.mergeAll(
  FeedParserLive,
  HtmlParserLive,
  ArticleExtractorLive,
  DocumentSanitizerLive
);
