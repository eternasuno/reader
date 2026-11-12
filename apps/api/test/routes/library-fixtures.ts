import {
  ArticleContent,
  ArticleDescription,
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
import { type DateTime, Effect, Option, Redacted, Schema } from 'effect';
import {
  FeedItemOrNullResponseSchema,
  FeedItemPageSchema,
  FeedItemResponseSchema,
  FeedResponseSchema,
  FeedsResponseSchema,
  FeedUnreadSchema,
  PreviewResponseSchema,
  SavedPageOrNullResponseSchema,
  SavedPagePageSchema,
  SavedPageResponseSchema,
  SavedPageUnreadSchema,
} from '../../../web/src/lib/library-schema.ts';
import type { CallOptions, Harness, TestSession } from './library-support';

const FOLDERS = '/api/library/folders';

const FEEDS = '/api/library/feeds';

const FolderSchema = Schema.Struct({
  id: Schema.String,
  ownerId: Schema.String,
  name: Schema.String,
});

export type FolderJson = typeof FolderSchema.Type;

const FoldersResponseSchema = Schema.Struct({
  items: Schema.Array(FolderSchema),
});

const FolderResponseSchema = Schema.Struct({ item: FolderSchema });

const decodeUrl = Schema.decodeSync(NormalizedUrl);

const decodeTitle = Schema.decodeSync(ArticleTitle);

let urlCount = 0;

const uniqueUrl = (prefix: string): string => {
  urlCount += 1;

  return `https://example.com/${prefix}/${urlCount}`;
};

type PageSeed = {
  readonly url?: string;
  readonly title?: string;
  readonly content?: string;
  readonly description?: string;
  readonly publishedAt?: DateTime.Utc;
  readonly read?: boolean;
};

type ItemSeed = {
  readonly url?: string;
  readonly title?: string;
  readonly content?: string;
  readonly extractedContent?: string;
  readonly description?: string;
  readonly publishedAt?: DateTime.Utc;
  readonly read?: boolean;
};

type FeedSeed = {
  readonly title?: string;
};

const optionalDescription = (
  text: string | undefined
): Option.Option<ArticleDescription> =>
  text === undefined
    ? Option.none()
    : Option.some(ArticleDescription.make(text));

const optionalContent = (
  text: string | undefined
): Option.Option<ArticleContent> =>
  text === undefined ? Option.none() : Option.some(ArticleContent.make(text));

export const seedPage = (
  harness: Harness,
  owner: OwnerId,
  seed: PageSeed = {}
): Effect.Effect<SavedPage, SavedPageRepositoryError> =>
  Effect.gen(function* () {
    const page = SavedPage.make({
      ownerId: owner,
      url: decodeUrl(seed.url ?? uniqueUrl('page')),
      title: decodeTitle(seed.title ?? 'Saved page'),
      description: optionalDescription(seed.description),
      content: ArticleContent.make(seed.content ?? '<p>Body</p>'),
      publishedAt: Option.fromUndefinedOr(seed.publishedAt),
      read: seed.read ?? false,
    });

    yield* harness.repositories.savedPage.create(owner, [page]);

    return page;
  });

export const seedPages = (
  harness: Harness,
  owner: OwnerId,
  count: number
): Effect.Effect<ReadonlyArray<SavedPage>, SavedPageRepositoryError> =>
  Effect.forEach(
    Array.from({ length: count }, (_, index) => index),
    (index) => seedPage(harness, owner, { title: `Page ${index + 1}` })
  );

export const seedFeed = (
  harness: Harness,
  owner: OwnerId,
  seed: FeedSeed = {}
): Effect.Effect<Feed, FeedRepositoryError> =>
  Effect.gen(function* () {
    const feed = Feed.make({
      ownerId: owner,
      url: decodeUrl(uniqueUrl('feed')),
      title: FeedTitle.make(seed.title ?? 'Example feed'),
      folderId: Option.none(),
      updatedAt: Option.none(),
    });

    yield* harness.repositories.feed.create(owner, [feed]);

    return feed;
  });

export const seedItem = (
  harness: Harness,
  owner: OwnerId,
  feedId: FeedId,
  seed: ItemSeed = {}
): Effect.Effect<FeedItem, FeedItemRepositoryError> =>
  Effect.gen(function* () {
    const item = FeedItem.make({
      ownerId: owner,
      feedId,
      url: decodeUrl(seed.url ?? uniqueUrl('item')),
      title: decodeTitle(seed.title ?? 'Feed article'),
      description: optionalDescription(seed.description),
      content: optionalContent(seed.content),
      extractedContent: optionalContent(seed.extractedContent),
      publishedAt: Option.fromUndefinedOr(seed.publishedAt),
      read: seed.read ?? false,
    });

    yield* harness.repositories.feedItem.create(owner, [item]);

    return item;
  });

export const sessionFor = (harness: Harness, email: string) =>
  Effect.promise(() => harness.signIn(email));

export const call = (harness: Harness, options: CallOptions) =>
  Effect.promise(() => harness.call(options));

export const groupFeed = (
  harness: Harness,
  session: TestSession,
  feedId: string,
  folderId: string
) =>
  call(harness, {
    method: 'PATCH',
    path: FEEDS,
    cookie: session.cookie,
    body: { id: feedId, folderId },
  });

export const itemAt = <A>(items: ReadonlyArray<A>, index: number): A => {
  const item = items[index];

  if (item === undefined) {
    throw new Error(`Missing item ${index}`);
  }

  return item;
};

export const requiredCursor = (page: {
  readonly cursor: string | null;
}): string => {
  if (page.cursor === null) {
    throw new Error('Expected a page cursor');
  }

  return page.cursor;
};

type FailureBody = {
  readonly _tag: string;
  readonly message: string;
  readonly id?: string;
  readonly url?: string;
};

export const readJson = <A>(response: Response): Promise<A> =>
  response.json() as Promise<A>;

export const readFailure = (response: Response) =>
  readJson<FailureBody>(response);

export const readSavedPages = async (response: Response) =>
  Schema.decodeUnknownPromise(SavedPagePageSchema)(await response.json());

export const readSavedPage = async (response: Response) =>
  (
    await Schema.decodeUnknownPromise(SavedPageResponseSchema)(
      await response.json()
    )
  ).item;

export const readNullableSavedPage = async (response: Response) =>
  (
    await Schema.decodeUnknownPromise(SavedPageOrNullResponseSchema)(
      await response.json()
    )
  ).item;

export const readUnreadCount = async (response: Response) =>
  Schema.decodeUnknownPromise(SavedPageUnreadSchema)(await response.json());

export const readFeeds = async (response: Response) =>
  (
    await Schema.decodeUnknownPromise(FeedsResponseSchema)(
      await response.json()
    )
  ).items;

export const readFeed = async (response: Response) =>
  (await Schema.decodeUnknownPromise(FeedResponseSchema)(await response.json()))
    .item;

export const readFeedItems = async (response: Response) =>
  Schema.decodeUnknownPromise(FeedItemPageSchema)(await response.json());

export const readFeedItem = async (response: Response) =>
  (
    await Schema.decodeUnknownPromise(FeedItemOrNullResponseSchema)(
      await response.json()
    )
  ).item;

export const readExtractedFeedItem = async (response: Response) =>
  (
    await Schema.decodeUnknownPromise(FeedItemResponseSchema)(
      await response.json()
    )
  ).item;

export const readPreview = async (response: Response) =>
  (
    await Schema.decodeUnknownPromise(PreviewResponseSchema)(
      await response.json()
    )
  ).preview;

export const readUnreadFeeds = async (response: Response) =>
  Schema.decodeUnknownPromise(FeedUnreadSchema)(await response.json());

export const seedFolder = (
  harness: Harness,
  session: TestSession,
  name: string
): Effect.Effect<FolderJson> =>
  Effect.gen(function* () {
    const response = yield* call(harness, {
      method: 'POST',
      path: FOLDERS,
      cookie: session.cookie,
      body: { name },
    });

    return yield* Effect.promise(() => readFolder(response));
  });

export const readFolders = async (response: Response) =>
  (
    await Schema.decodeUnknownPromise(FoldersResponseSchema)(
      await response.json()
    )
  ).items;

export const readFolder = async (response: Response) =>
  (
    await Schema.decodeUnknownPromise(FolderResponseSchema)(
      await response.json()
    )
  ).item;

export const storedFetcher = (harness: Harness, owner: OwnerId) =>
  Effect.map(harness.repositories.setting.get(owner), (setting) => ({
    provider: setting.fetcher.provider,
    key: Option.getOrUndefined(
      Option.map(setting.fetcher.jina.key, Redacted.value)
    ),
    endpoint: Option.getOrUndefined(
      Option.map(
        setting.fetcher.browser.endpoint,
        (endpoint) => Redacted.value(endpoint).href
      )
    ),
  }));
