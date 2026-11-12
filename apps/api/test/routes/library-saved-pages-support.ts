import {
  ArticleContent,
  ArticleDescription,
  ArticleTitle,
  Feed,
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
  SavedPageOrNullResponseSchema,
  SavedPagePageSchema,
  SavedPageResponseSchema,
  SavedPageUnreadSchema,
} from '../../../web/src/lib/library-schema.ts';
import type { CallOptions, Harness, TestSession } from './library-support';

const decodeUrl = Schema.decodeSync(NormalizedUrl);

const decodeTitle = Schema.decodeSync(ArticleTitle);

let urlCount = 0;

const uniqueUrl = (): string => {
  urlCount += 1;

  return `https://example.com/saved/${urlCount}`;
};

export type RawSavedPage = {
  readonly description?: string;
  readonly publishedAt?: string;
};

export type RawPage = {
  readonly items: ReadonlyArray<RawSavedPage>;
  readonly cursor: string | null;
};

export type FailureBody = {
  readonly _tag: string;
  readonly message: string;
  readonly id?: string;
  readonly url?: string;
};

export type PageSeed = {
  readonly url?: string;
  readonly title?: string;
  readonly content?: string;
  readonly description?: string;
  readonly publishedAt?: DateTime.Utc;
  readonly read?: boolean;
};

export type ItemSeed = {
  readonly url?: string;
  readonly title?: string;
  readonly content?: string;
  readonly extractedContent?: string;
  readonly description?: string;
  readonly publishedAt?: DateTime.Utc;
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

const makePage = (owner: OwnerId, seed: PageSeed = {}): SavedPage =>
  SavedPage.make({
    ownerId: owner,
    url: decodeUrl(seed.url ?? uniqueUrl()),
    title: decodeTitle(seed.title ?? 'Saved page'),
    description: optionalDescription(seed.description),
    content: ArticleContent.make(seed.content ?? '<p>Body</p>'),
    publishedAt: Option.fromUndefinedOr(seed.publishedAt),
    read: seed.read ?? false,
  });

export const seedPage = (
  harness: Harness,
  owner: OwnerId,
  seed: PageSeed = {}
): Effect.Effect<SavedPage, SavedPageRepositoryError> =>
  Effect.gen(function* () {
    const page = makePage(owner, seed);

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

const seedFeed = (harness: Harness, owner: OwnerId) =>
  Effect.gen(function* () {
    const feed = Feed.make({
      ownerId: owner,
      url: decodeUrl(uniqueUrl()),
      title: FeedTitle.make('Example feed'),
      updatedAt: Option.none(),
    });

    yield* harness.repositories.feed.create(owner, [feed]);

    return feed;
  });

export const seedFeedItem = (
  harness: Harness,
  owner: OwnerId,
  seed: ItemSeed = {}
): Effect.Effect<FeedItem, FeedRepositoryError | FeedItemRepositoryError> =>
  Effect.gen(function* () {
    const feed = yield* seedFeed(harness, owner);
    const item = FeedItem.make({
      ownerId: owner,
      feedId: feed.id,
      url: decodeUrl(seed.url ?? uniqueUrl()),
      title: decodeTitle(seed.title ?? 'Feed article'),
      description: optionalDescription(seed.description),
      content: optionalContent(seed.content),
      extractedContent: optionalContent(seed.extractedContent),
      publishedAt: Option.fromUndefinedOr(seed.publishedAt),
      read: false,
    });

    yield* harness.repositories.feedItem.create(owner, [item]);

    return item;
  });

export const sessionFor = (harness: Harness, email: string) =>
  Effect.promise(() => harness.signIn(email));

export const addPage = (
  harness: Harness,
  session: TestSession,
  url: string
): Promise<Response> =>
  harness.call({
    method: 'POST',
    path: '/api/library/saved-pages',
    cookie: session.cookie,
    body: { url },
  });

export const listPages = (
  harness: Harness,
  session: TestSession,
  query: CallOptions['query'] = {}
): Promise<Response> =>
  harness.call({
    path: '/api/library/saved-pages',
    query,
    cookie: session.cookie,
  });

export const readPage = async (response: Response) => {
  const raw = (await response.json()) as RawPage;
  const page = await Schema.decodeUnknownPromise(SavedPagePageSchema)(raw);

  return { raw, page };
};

export const readItem = async (response: Response) => {
  const raw = (await response.json()) as { readonly item: RawSavedPage };
  const { item } = await Schema.decodeUnknownPromise(SavedPageResponseSchema)(
    raw
  );

  return { raw: raw.item, item };
};

export const readNullableItem = async (response: Response) => {
  const raw = (await response.json()) as {
    readonly item: RawSavedPage | null;
  };
  const { item } = await Schema.decodeUnknownPromise(
    SavedPageOrNullResponseSchema
  )(raw);

  return { raw: raw.item, item };
};

export const readUnreadCount = async (response: Response) =>
  Schema.decodeUnknownPromise(SavedPageUnreadSchema)(await response.json());

export const readFailure = async (response: Response): Promise<FailureBody> =>
  (await response.json()) as FailureBody;

export const itemAt = <A>(items: ReadonlyArray<A>, index: number): A => {
  const item = items[index];

  if (item === undefined) {
    throw new Error(`Missing item ${index}`);
  }

  return item;
};
