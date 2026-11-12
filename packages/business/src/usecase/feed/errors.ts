import { Data } from 'effect';
import type { NormalizedUrl } from '../../entity/common/normalized-url';
import type { FeedItemId } from '../../entity/feed/feed-item';

export class FeedAlreadyExists extends Data.TaggedError('FeedAlreadyExists')<{
  readonly url: NormalizedUrl;
}> {}

export class FeedItemNotFound extends Data.TaggedError('FeedItemNotFound')<{
  readonly id: FeedItemId;
}> {}

export class FetchFeedError extends Data.TaggedError('FetchFeedError')<{
  readonly message: string;
}> {}
