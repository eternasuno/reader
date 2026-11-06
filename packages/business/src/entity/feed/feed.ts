import { Schema } from 'effect';
import { NormalizedUrl } from '../object-value/normalized-url';
import { OwnerId } from '../object-value/owner-id';

export const FeedId = Schema.String.pipe(Schema.brand('FeedId'));

export type FeedId = typeof FeedId.Type;

export const Feed = Schema.Struct({
  id: FeedId,
  ownerId: OwnerId,
  url: NormalizedUrl,
  title: Schema.String,
  updatedAt: Schema.DateTimeUtcFromDate,
});

export type Feed = typeof Feed.Type;
