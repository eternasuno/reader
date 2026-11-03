import { Schema } from 'effect';
import { FeedId, OwnerId } from './object-value';

export const Feed = Schema.Struct({
  id: FeedId,
  ownerId: OwnerId,
  url: Schema.URLFromString,
  title: Schema.String,
  updatedAt: Schema.DateTimeUtcFromDate,
});

export type Feed = typeof Feed.Type;
