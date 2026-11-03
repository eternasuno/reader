import { Schema } from 'effect';

export const OwnerId = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.brand('OwnerId')
);

export type OwnerId = typeof OwnerId.Type;

export const FeedId = Schema.String.pipe(Schema.brand('FeedId'));

export type FeedId = typeof FeedId.Type;
