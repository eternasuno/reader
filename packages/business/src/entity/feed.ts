import { Schema } from 'effect';
import { FeedId, NormalizedUrl, OwnerId } from './object-value';

export const Feed = Schema.Struct({
  id: FeedId,
  ownerId: OwnerId,
  url: NormalizedUrl,
  title: Schema.String,
  updatedAt: Schema.DateTimeUtcFromDate,
});

export type Feed = typeof Feed.Type;
