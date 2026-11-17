import { Data } from 'effect';
import type { NormalizedUrl } from '../entity/common/normalized-url';

/**
 * The owner already follows this URL. It carries the key, so nothing is looked
 * up when the unique URL of `create` lost the race (CM-ID-6, FD-SUB-2).
 */
export class FeedAlreadyExists extends Data.TaggedError('FeedAlreadyExists')<{
  readonly url: NormalizedUrl;
}> {}

/**
 * The source could not be fetched, including a response that is not 2xx
 * (FD-FETCH-2).
 */
export class FetchFeedError extends Data.TaggedError('FetchFeedError')<{
  readonly message: string;
}> {}

/** The source is not one of RSS, Atom, RDF or JSON Feed (FD-PARSE-1, FD-FETCH-2). */
export class FeedParserError extends Data.TaggedError('FeedParserError')<{
  readonly message: string;
}> {}

/** A storage failure raised by the `FeedRepository` port. */
export class FeedRepositoryError extends Data.TaggedError(
  'FeedRepositoryError'
)<{ readonly message: string }> {}
