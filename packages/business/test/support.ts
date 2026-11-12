import { type DateTime, Effect, Option, Schema } from 'effect';
import {
  ArticleContent,
  ArticleDescription,
  ArticleTitle,
} from '../src/entity/common/article';
import { NormalizedUrl } from '../src/entity/common/normalized-url';
import { OptionFromOptionalNonEmpty } from '../src/entity/common/option-from-optional-non-empty';
import { OwnerId } from '../src/entity/common/owner-id';
import { Feed, type FeedId, FeedTitle } from '../src/entity/feed/feed';
import { FeedItem, type FeedItemId } from '../src/entity/feed/feed-item';
import {
  SavedPage,
  type SavedPageId,
} from '../src/entity/saved-page/saved-page';
import { BrowserEndpoint, JinaKey } from '../src/entity/setting/fetcher';
import { Retention } from '../src/entity/setting/retention';
import {
  FeedRepository,
  type FeedRepositoryError,
} from '../src/port/feed-repository';

export const alice = OwnerId.make('alice');

export const bob = OwnerId.make('bob');

export const decodeUrl = Schema.decodeSync(NormalizedUrl);

export const decodeTitle = Schema.decodeSync(ArticleTitle);

export const decodeDescription = Schema.decodeSync(
  OptionFromOptionalNonEmpty(ArticleDescription)
);

export const decodeContent = Schema.decodeSync(
  OptionFromOptionalNonEmpty(ArticleContent)
);

export const parsedDocument = (html = ''): Document =>
  ({ body: { innerHTML: html } }) as unknown as Document;

const defaultFeedUrl = decodeUrl('https://example.com/feed.xml');

export type FeedOverrides = {
  readonly id?: FeedId;
  readonly ownerId?: OwnerId;
  readonly url?: NormalizedUrl;
  readonly title?: FeedTitle;
  readonly updatedAt?: Option.Option<DateTime.Utc>;
};

export const makeFeed = (overrides: FeedOverrides = {}): Feed =>
  Feed.make({
    ownerId: alice,
    url: defaultFeedUrl,
    title: FeedTitle.make('Feed'),
    updatedAt: Option.none(),
    ...overrides,
  });

const defaultFeedId = makeFeed().id;

export type FeedItemOverrides = {
  readonly id?: FeedItemId;
  readonly ownerId?: OwnerId;
  readonly feedId?: FeedId;
  readonly url?: NormalizedUrl;
  readonly title?: ArticleTitle;
  readonly description?: Option.Option<ArticleDescription>;
  readonly content?: Option.Option<ArticleContent>;
  readonly extractedContent?: Option.Option<ArticleContent>;
  readonly publishedAt?: Option.Option<DateTime.Utc>;
  readonly read?: boolean;
};

export const makeFeedItem = (overrides: FeedItemOverrides = {}): FeedItem =>
  FeedItem.make({
    ownerId: alice,
    feedId: defaultFeedId,
    url: decodeUrl('https://example.com/item'),
    title: decodeTitle('Item'),
    description: Option.none(),
    content: Option.none(),
    extractedContent: Option.none(),
    publishedAt: Option.none(),
    read: false,
    ...overrides,
  });

export type SavedPageOverrides = {
  readonly id?: SavedPageId;
  readonly ownerId?: OwnerId;
  readonly url?: NormalizedUrl;
  readonly title?: ArticleTitle;
  readonly description?: Option.Option<ArticleDescription>;
  readonly content?: ArticleContent;
  readonly publishedAt?: Option.Option<DateTime.Utc>;
  readonly read?: boolean;
};

export const makeSavedPage = (overrides: SavedPageOverrides = {}): SavedPage =>
  SavedPage.make({
    ownerId: alice,
    url: decodeUrl('https://example.com/page'),
    title: decodeTitle('Page'),
    description: Option.none(),
    content: ArticleContent.make('<p>Body</p>'),
    publishedAt: Option.none(),
    read: false,
    ...overrides,
  });

let urlCounter = 0;

export const uniqueUrl = (path: string): NormalizedUrl => {
  urlCounter += 1;

  return decodeUrl(`https://example.com/${path}/${urlCounter}`);
};

export const makeUniqueFeed = (overrides: FeedOverrides = {}): Feed =>
  makeFeed({ url: uniqueUrl('feed'), ...overrides });

export const makeUniqueFeedItem = (
  overrides: FeedItemOverrides = {}
): FeedItem => makeFeedItem({ url: uniqueUrl('item'), ...overrides });

export const makeUniqueSavedPage = (
  overrides: SavedPageOverrides = {}
): SavedPage => makeSavedPage({ url: uniqueUrl('page'), ...overrides });

export const idsOf = (
  rows: ReadonlyArray<{ readonly id: string }>
): Array<string> => rows.map((row) => row.id);

export const storedFeed = (
  owner: OwnerId = alice
): Effect.Effect<Feed, FeedRepositoryError, FeedRepository> =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const feed = makeUniqueFeed({ ownerId: owner });
    yield* feeds.create(owner, [feed]);

    return feed;
  });

export const decodeRetention = Schema.decodeSync(Retention);

export const decodeJinaKey = Schema.decodeSync(JinaKey);

export const decodeBrowserEndpoint = Schema.decodeSync(BrowserEndpoint);
