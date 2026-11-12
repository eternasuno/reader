import { Schema } from 'effect';
import { Model } from 'effect/schema';
import { NormalizedUrl } from '../common/normalized-url';
import { OwnerId } from '../common/owner-id';

export const FeedId = Schema.String.pipe(
  Schema.check(Schema.isUUID(7), Schema.isLowercased()),
  Schema.brand('FeedId')
);

export type FeedId = typeof FeedId.Type;

export const FeedTitle = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand('FeedTitle')
);

export type FeedTitle = typeof FeedTitle.Type;

export const makeFeedTitle = (text: string, url: URL): FeedTitle => {
  const trimmed = text.trim();

  return FeedTitle.make(trimmed === '' ? url.host : trimmed);
};

export const Feed = Schema.Struct({
  id: Model.UuidV7WithGenerate(FeedId),
  ownerId: OwnerId,
  url: NormalizedUrl,
  title: FeedTitle,
  updatedAt: Schema.OptionFromOptional(Schema.DateTimeUtcFromDate),
});

export type Feed = typeof Feed.Type;
