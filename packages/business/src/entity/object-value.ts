import { Schema } from 'effect';

export const OwnerId = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.brand('OwnerId')
);

export type OwnerId = typeof OwnerId.Type;

export const FeedId = Schema.String.check(
  Schema.isPattern(/^[a-f0-9]{64}$/)
).pipe(Schema.brand('FeedId'));

export type FeedId = typeof FeedId.Type;

export const ArticleId = Schema.String.check(
  Schema.isPattern(/^[a-f0-9]{64}$/)
).pipe(Schema.brand('ArticleId'));

export type ArticleId = typeof ArticleId.Type;

export const ReaderProvider = Schema.Literals(['jina', 'browser']);

export type ReaderProvider = typeof ReaderProvider.Type;

export const Retention = Schema.Int.check(
  Schema.isBetween({ minimum: 30, maximum: 300 })
);
