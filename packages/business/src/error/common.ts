import { Data } from 'effect';

/**
 * The extracted content is empty: sanitized text that is blank after trimming
 * (CM-ART-5, CM-FETCH step 4). Nothing is stored.
 */
export class ArticleEmptyContent extends Data.TaggedError(
  'ArticleEmptyContent'
)<Record<never, never>> {}

/**
 * The page could not be fetched. Redirects, timeouts, size limits and which
 * addresses may be reached are the fetcher's concern (CM-FETCH-3): a failure
 * of any of them is this error, and the message is safe to log (CM-FETCH-4).
 */
export class WebpageFetcherError extends Data.TaggedError(
  'WebpageFetcherError'
)<{
  readonly message: string;
}> {}

/** The page could not be parsed (CM-FETCH-4, CM-HTML-4). */
export class HtmlParserError extends Data.TaggedError('HtmlParserError')<{
  readonly message: string;
}> {}

/** The article could not be extracted (CM-FETCH-4). */
export class ArticleExtractorError extends Data.TaggedError(
  'ArticleExtractorError'
)<{
  readonly message: string;
}> {}

/** The document could not be sanitized (CM-HTML-4). */
export class DocumentSanitizerError extends Data.TaggedError(
  'DocumentSanitizerError'
)<{
  readonly message: string;
}> {}
