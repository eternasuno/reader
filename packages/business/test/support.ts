import { type DateTime, Effect, Schema } from 'effect';
import { Feed, FeedId } from '../src/entity/feed/feed';
import { FeedItem } from '../src/entity/feed/feed-item';
import {
  ArticleContent,
  ArticleDescription,
  ArticleTitle,
} from '../src/entity/object-value/article';
import { NormalizedUrl } from '../src/entity/object-value/normalized-url';
import { OptionFromOptionalNonEmpty } from '../src/entity/object-value/option-from-optional-non-empty';
import { OwnerId } from '../src/entity/object-value/owner-id';
import { SavedPage } from '../src/entity/saved-page/saved-page';
import { ListCursorFromString } from '../src/usecase/list-cursor';

export const decodeContent = Schema.decodeSync(
  OptionFromOptionalNonEmpty(ArticleContent)
);

export const decodeDescription = Schema.decodeSync(
  OptionFromOptionalNonEmpty(ArticleDescription)
);

export const decodeTitle = Schema.decodeSync(ArticleTitle);

export const decodeUrl = Schema.decodeSync(NormalizedUrl);

export const alice = OwnerId.make('alice');

export const bob = OwnerId.make('bob');

export const feedId = FeedId.make('f'.repeat(64));

export const otherFeedId = FeedId.make('e'.repeat(64));

export const hex = (value: number): string =>
  value.toString(16).padStart(64, '0');

export const decodeCursor = (wire: string) =>
  Schema.decodeSync(ListCursorFromString)(wire);

export const extractedPublishedAt = Schema.decodeSync(
  Schema.DateTimeUtcFromString
)('2024-05-06T07:08:09.000Z');

export const timeOf = (publishedAt: DateTime.Utc): string =>
  Schema.encodeSync(Schema.DateTimeUtcFromString)(publishedAt);

export const parsedDocument = (html = ''): Document =>
  ({ body: { innerHTML: html } }) as unknown as Document;

export const storedFeed = (id: FeedId = feedId): Feed =>
  Schema.decodeUnknownSync(Feed)({
    id,
    ownerId: alice,
    url: 'https://example.com/feed.xml',
    title: 'Feed',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

const baseTime = Date.UTC(2026, 0, 1, 12);

export const makeFeedItem = (overrides: Record<string, unknown> = {}) =>
  Schema.decodeUnknownSync(FeedItem)({
    id: hex(1),
    feedId,
    title: 'Title',
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    read: false,
    ...overrides,
  });

export const makeSavedPage = (overrides: Record<string, unknown> = {}) =>
  Schema.decodeUnknownSync(SavedPage)({
    id: hex(1),
    ownerId: alice,
    title: 'Title',
    content: '<p>Body</p>',
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    read: false,
    ...overrides,
  });

export const series = <T>(
  count: number,
  make: (overrides: Record<string, unknown>) => T
): Array<T> =>
  Array.from({ length: count }, (_, index) =>
    make({
      id: hex(index),
      title: `Item ${index}`,
      publishedAt: new Date(baseTime + index * 60_000),
    })
  );

type Listed = { readonly id: string; readonly publishedAt: DateTime.Utc };

/**
 * Fake listing store keeping `items` in list order: `after` is the exclusive
 * suffix past the boundary, `through` the inclusive prefix up to it. The
 * boundary is matched by its (publishedAt, id) tuple, so a removed boundary
 * item still bounds the returned page.
 */
export const pagedStore =
  <T extends Listed>(items: ReadonlyArray<T>) =>
  (query: {
    readonly after?: Listed;
    readonly through?: Listed;
    readonly limit: number;
  }) => {
    const isLaterThan = (item: Listed, boundary: Listed): boolean => {
      const publishedAt = timeOf(item.publishedAt);
      const boundaryAt = timeOf(boundary.publishedAt);

      return (
        publishedAt > boundaryAt ||
        (publishedAt === boundaryAt && item.id > boundary.id)
      );
    };

    return Effect.succeed(
      items
        .filter(
          (item) =>
            (query.after === undefined || isLaterThan(item, query.after)) &&
            (query.through === undefined || !isLaterThan(item, query.through))
        )
        .slice(0, query.limit)
    );
  };
