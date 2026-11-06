import { Data } from 'effect';
import type { FeedId } from '../entity/feed/feed';
import type { FeedItemId } from '../entity/feed/feed-item';

export class FeedUrlInvalid extends Data.TaggedError('FeedUrlInvalid')<{
  readonly message: string;
}> {}

export class FeedExists extends Data.TaggedError('FeedExists')<{
  readonly message: string;
  readonly id: FeedId;
}> {}

export class FeedNotFound extends Data.TaggedError('FeedNotFound')<{
  readonly message: string;
  readonly id: FeedId;
}> {}

export class FeedItemNotFound extends Data.TaggedError('FeedItemNotFound')<{
  readonly message: string;
  readonly id: FeedItemId;
}> {}

export class FeedItemMissingUrl extends Data.TaggedError('FeedItemMissingUrl')<{
  readonly message: string;
}> {}
