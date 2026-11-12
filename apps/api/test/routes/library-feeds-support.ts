import {
  ArticleContent,
  ArticleTitle,
  Feed,
  type FeedId,
  FeedItem,
  type FeedItemRepositoryError,
  type FeedRepositoryError,
  FeedTitle,
  NormalizedUrl,
  type OwnerId,
  SavedPage,
  type SavedPageRepositoryError,
} from '@reader/business';
import { type DateTime, Effect, Option, Schema } from 'effect';
import {
  FeedItemOrNullResponseSchema,
  FeedItemPageSchema,
  FeedItemResponseSchema,
  FeedResponseSchema,
  FeedsResponseSchema,
  FeedUnreadSchema,
  PreviewResponseSchema,
} from '../../../web/src/lib/library-schema.ts';
import type { CallOptions, Harness, TestSession } from './library-support';

export const PATHS = {
  feeds: '/api/library/feeds',
  preview: '/api/library/feeds/preview',
  unread: '/api/library/feeds/unread',
  markFeeds: '/api/library/feeds/mark-read',
  markAll: '/api/library/feeds/mark-all-read',
  items: '/api/library/feeds/items',
  item: '/api/library/feeds/items/item',
  extract: '/api/library/feeds/items/extract',
  markItems: '/api/library/feeds/items/mark-read',
} as const;

export type RawFeed = {
  readonly id: string;
  readonly ownerId: string;
  readonly url: string;
  readonly title: string;
  readonly updatedAt?: string;
};

export type RawItem = {
  readonly id: string;
  readonly ownerId: string;
  readonly feedId: string;
  readonly url: string;
  readonly title: string;
  readonly description?: string;
  readonly content?: string;
  readonly extractedContent?: string;
  readonly publishedAt?: string;
  readonly read: boolean;
};

export type RawPage = {
  readonly items: ReadonlyArray<RawItem>;
  readonly cursor: string | null;
};

export type FailureBody = {
  readonly _tag: string;
  readonly message: string;
  readonly id?: string;
  readonly url?: string;
};

export type FeedSeed = {
  readonly url?: string;
  readonly title?: string;
  readonly updatedAt?: DateTime.Utc;
};

export type ItemSeed = {
  readonly url?: string;
  readonly title?: string;
  readonly read?: boolean;
};

const decodeUrl = Schema.decodeSync(NormalizedUrl);

let urlCount = 0;

const uniqueUrl = (prefix: string): string => {
  urlCount += 1;

  return `https://example.com/${prefix}/${urlCount}`;
};

export const firstOf = <A>(rows: ReadonlyArray<A>): A =>
  Option.getOrThrow(Option.fromUndefinedOr(rows[0]));

const makeFeedRow = (owner: OwnerId, seed: FeedSeed = {}): Feed =>
  Feed.make({
    ownerId: owner,
    url: decodeUrl(seed.url ?? uniqueUrl('feed')),
    title: FeedTitle.make(seed.title ?? 'Example feed'),
    updatedAt: Option.fromUndefinedOr(seed.updatedAt),
  });

const makeItemRow = (
  owner: OwnerId,
  feedId: FeedId,
  seed: ItemSeed = {}
): FeedItem =>
  FeedItem.make({
    ownerId: owner,
    feedId,
    url: decodeUrl(seed.url ?? uniqueUrl('item')),
    title: Schema.decodeSync(ArticleTitle)(seed.title ?? 'Article'),
    description: Option.none(),
    content: Option.none(),
    extractedContent: Option.none(),
    publishedAt: Option.none(),
    read: seed.read ?? false,
  });

export const seedFeed = (
  harness: Harness,
  owner: OwnerId,
  seed: FeedSeed = {}
): Effect.Effect<Feed, FeedRepositoryError> =>
  Effect.gen(function* () {
    const feed = makeFeedRow(owner, seed);

    yield* harness.repositories.feed.create(owner, [feed]);

    return feed;
  });

export const seedFeedItems = (
  harness: Harness,
  owner: OwnerId,
  feedId: FeedId,
  seeds: ReadonlyArray<ItemSeed>
): Effect.Effect<ReadonlyArray<FeedItem>, FeedItemRepositoryError> =>
  Effect.gen(function* () {
    const items = seeds.map((seed) => makeItemRow(owner, feedId, seed));

    yield* harness.repositories.feedItem.create(owner, items);

    return items;
  });

export const seedItem = (
  harness: Harness,
  owner: OwnerId,
  feedId: FeedId,
  seed: ItemSeed = {}
): Effect.Effect<FeedItem, FeedItemRepositoryError> =>
  Effect.gen(function* () {
    const item = makeItemRow(owner, feedId, seed);

    yield* harness.repositories.feedItem.create(owner, [item]);

    return item;
  });

export const seedSavedPageFromItem = (
  harness: Harness,
  owner: OwnerId,
  item: FeedItem
): Effect.Effect<SavedPage, SavedPageRepositoryError> =>
  Effect.gen(function* () {
    const page = SavedPage.make({
      ownerId: owner,
      url: item.url,
      title: item.title,
      description: Option.none(),
      content: ArticleContent.make('<p>Body</p>'),
      publishedAt: Option.none(),
      read: false,
    });

    yield* harness.repositories.savedPage.create(owner, [page]);

    return page;
  });

export const sessionFor = (harness: Harness, email: string) =>
  Effect.promise(() => harness.signIn(email));

const asSession =
  (harness: Harness, session: TestSession) =>
  (options: Omit<CallOptions, 'cookie'>) =>
    harness.call({ ...options, cookie: session.cookie });

export const listFeeds = (harness: Harness, session: TestSession) =>
  asSession(harness, session)({ path: PATHS.feeds });

export const fetchFeedItems = (
  harness: Harness,
  session: TestSession,
  query: NonNullable<CallOptions['query']>
) => asSession(harness, session)({ path: PATHS.items, query });

export const fetchFeedItem = (
  harness: Harness,
  session: TestSession,
  id: string
) => asSession(harness, session)({ path: PATHS.item, query: { id } });

export const previewFeed = (
  harness: Harness,
  session: TestSession,
  url: string
) =>
  asSession(
    harness,
    session
  )({ method: 'POST', path: PATHS.preview, body: { url } });

export const subscribe = (
  harness: Harness,
  session: TestSession,
  body: object
) => asSession(harness, session)({ method: 'POST', path: PATHS.feeds, body });

export const unsubscribe = (
  harness: Harness,
  session: TestSession,
  id: string
) =>
  asSession(
    harness,
    session
  )({ method: 'DELETE', path: PATHS.feeds, body: { id } });

export const fetchUnreadFeeds = (harness: Harness, session: TestSession) =>
  asSession(harness, session)({ path: PATHS.unread });

export const markFeedsRead = (
  harness: Harness,
  session: TestSession,
  feedIds: ReadonlyArray<string>
) =>
  asSession(
    harness,
    session
  )({
    method: 'POST',
    path: PATHS.markFeeds,
    body: { feedIds },
  });

export const markAllFeedItemsRead = (harness: Harness, session: TestSession) =>
  asSession(
    harness,
    session
  )({ method: 'POST', path: PATHS.markAll, body: {} });

export const markFeedItem = (
  harness: Harness,
  session: TestSession,
  body: object
) => asSession(harness, session)({ method: 'PATCH', path: PATHS.items, body });

export const markFeedItemsRead = (
  harness: Harness,
  session: TestSession,
  ids: ReadonlyArray<string>
) =>
  asSession(
    harness,
    session
  )({
    method: 'POST',
    path: PATHS.markItems,
    body: { ids },
  });

export const extractFeedItem = (
  harness: Harness,
  session: TestSession,
  id: string
) =>
  asSession(
    harness,
    session
  )({ method: 'POST', path: PATHS.extract, body: { id } });

export const readFailure = async (response: Response) =>
  (await response.json()) as FailureBody;

export const readFeeds = async (response: Response) => {
  const raw = (await response.json()) as {
    readonly items: ReadonlyArray<RawFeed>;
  };
  const page = await Schema.decodePromise(FeedsResponseSchema)(raw);

  return { raw: raw.items, page };
};

export const readFeed = async (response: Response) => {
  const raw = (await response.json()) as { readonly item: RawFeed };
  const { item } = await Schema.decodePromise(FeedResponseSchema)(raw);

  return { raw: raw.item, item };
};

export const readItemPage = async (response: Response) => {
  const raw = (await response.json()) as RawPage;
  const page = await Schema.decodePromise(FeedItemPageSchema)(raw);

  return { raw, page };
};

export const readItem = async (response: Response) => {
  const raw = (await response.json()) as { readonly item: RawItem | null };
  const { item } = await Schema.decodePromise(FeedItemOrNullResponseSchema)(
    raw
  );

  return { raw: raw.item, item };
};

export const readExtractedItem = async (response: Response) => {
  const raw = (await response.json()) as { readonly item: RawItem };
  const { item } = await Schema.decodePromise(FeedItemResponseSchema)(raw);

  return { raw: raw.item, item };
};

export const readPreview = async (response: Response) => {
  const body: unknown = await response.json();
  const raw = body as {
    readonly preview: {
      readonly url: string;
      readonly title: string;
      readonly description?: string;
      readonly titles: ReadonlyArray<string>;
    };
  };
  const decoded = await Schema.decodeUnknownPromise(PreviewResponseSchema)(
    body
  );

  return { raw: raw.preview, preview: decoded.preview };
};

export const readUnreadFeeds = async (response: Response) =>
  Schema.decodeUnknownPromise(FeedUnreadSchema)(await response.json());
