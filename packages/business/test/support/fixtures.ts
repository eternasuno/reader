import { DateTime, Effect, Option, Schema } from 'effect';
import {
  ArticleContent,
  type ArticleDescription,
  ArticleTitle,
} from '../../src/entity/common/article';
import { NormalizedUrl } from '../../src/entity/common/normalized-url';
import { OwnerId } from '../../src/entity/common/owner-id';
import {
  Feed,
  type FeedId,
  type FeedOrder,
  type FeedReaderMode,
  FeedTitle,
} from '../../src/entity/feed/feed';
import {
  FeedItem,
  type FeedItemId,
} from '../../src/entity/feed-item/feed-item';
import {
  Folder,
  type FolderId,
  FolderName,
} from '../../src/entity/folder/folder';
import {
  SavedPage,
  type SavedPageId,
} from '../../src/entity/saved-page/saved-page';
import { BrowserEndpoint, JinaKey } from '../../src/entity/setting/fetcher';
import {
  EmailAddress,
  KindleDelivery,
  SendTime,
  SmtpHost,
  SmtpPassword,
  SmtpPort,
  SmtpUser,
} from '../../src/entity/setting/kindle';
import { Retention } from '../../src/entity/setting/retention';
import type { FeedRepositoryError } from '../../src/error/feed';
import type { FolderRepositoryError } from '../../src/error/folder';
import type {
  FeedItemQuery,
  FeedUnreadCount,
} from '../../src/port/feed-item-repository';
import { FeedRepository } from '../../src/port/feed-repository';
import { FolderRepository } from '../../src/port/folder-repository';
import type { SavedPageQuery } from '../../src/port/saved-page-repository';

export const alice = OwnerId.make('alice');

export const bob = OwnerId.make('bob');

export const decodeUrl = Schema.decodeSync(NormalizedUrl);

export const decodeTitle = Schema.decodeSync(ArticleTitle);

export const decodeRetention = Schema.decodeSync(Retention);

export const decodeJinaKey = Schema.decodeSync(JinaKey);

export const decodeBrowserEndpoint = Schema.decodeSync(BrowserEndpoint);

export const decodeEmailAddress = Schema.decodeSync(EmailAddress);

export const decodeSmtpHost = Schema.decodeSync(SmtpHost);

export const decodeSmtpPort = Schema.decodeSync(SmtpPort);

export const decodeSmtpUser = Schema.decodeSync(SmtpUser);

export const decodeSmtpPassword = Schema.decodeSync(SmtpPassword);

export const decodeSendTime = Schema.decodeSync(SendTime);

export type KindleDeliveryOverrides = Partial<KindleDelivery>;

/** A saved Kindle delivery; no login and no send time unless overridden (SET-KINDLE-1). */
export const kindleDelivery = (
  overrides: KindleDeliveryOverrides = {}
): KindleDelivery =>
  KindleDelivery.make({
    kindleEmail: decodeEmailAddress('kindle@example.com'),
    senderEmail: decodeEmailAddress('sender@example.com'),
    smtpHost: decodeSmtpHost('smtp.example.com'),
    smtpPort: decodeSmtpPort(465),
    smtpSecurity: 'tls',
    smtpUser: Option.none(),
    sendTime: Option.none(),
    ...overrides,
  });

let counter = 0;

const nextTag = (): number => {
  counter += 1;

  return counter;
};

export const uniqueUrl = (path: string): NormalizedUrl =>
  decodeUrl(`https://example.com/${path}/${nextTag()}`);

export const uniqueFolderName = (prefix = 'Folder'): FolderName =>
  FolderName.make(`${prefix} ${nextTag()}`);

export type FeedOverrides = {
  readonly id?: FeedId;
  readonly ownerId?: OwnerId;
  readonly url?: NormalizedUrl;
  readonly title?: FeedTitle;
  readonly folderId?: Option.Option<FolderId>;
  readonly updatedAt?: Option.Option<DateTime.Utc>;
  readonly readerMode?: FeedReaderMode;
  readonly order?: FeedOrder;
};

export const makeFeed = (overrides: FeedOverrides = {}): Feed =>
  Feed.make({
    ownerId: alice,
    url: decodeUrl('https://example.com/feed.xml'),
    title: FeedTitle.make('Feed'),
    folderId: Option.none(),
    updatedAt: Option.none(),
    ...overrides,
  });

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
    feedId: makeFeed().id,
    url: decodeUrl('https://example.com/item'),
    title: decodeTitle('Item'),
    description: Option.none(),
    content: Option.none(),
    extractedContent: Option.none(),
    publishedAt: Option.none(),
    read: false,
    ...overrides,
  });

export type FolderOverrides = {
  readonly id?: FolderId;
  readonly ownerId?: OwnerId;
  readonly name?: FolderName;
};

export const makeFolder = (overrides: FolderOverrides = {}): Folder =>
  Folder.make({
    ownerId: alice,
    name: FolderName.make('Folder'),
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

export const makeUniqueFeed = (overrides: FeedOverrides = {}): Feed =>
  makeFeed({ url: uniqueUrl('feed'), ...overrides });

export const makeUniqueFeedItem = (
  overrides: FeedItemOverrides = {}
): FeedItem => makeFeedItem({ url: uniqueUrl('item'), ...overrides });

export const makeUniqueFolder = (overrides: FolderOverrides = {}): Folder =>
  makeFolder({ name: uniqueFolderName(), ...overrides });

export const makeUniqueSavedPage = (
  overrides: SavedPageOverrides = {}
): SavedPage => makeSavedPage({ url: uniqueUrl('page'), ...overrides });

export const feedRow = (title = 'Feed', owner = alice): Feed =>
  makeUniqueFeed({ ownerId: owner, title: FeedTitle.make(title) });

export const folderRow = (name: string, owner = alice): Folder =>
  makeUniqueFolder({ ownerId: owner, name: FolderName.make(name) });

export const folderFeedRow = (folderId: FolderId, owner = alice): Feed =>
  makeUniqueFeed({ ownerId: owner, folderId: Option.some(folderId) });

export const itemRow = (
  feedId: FeedId,
  overrides: FeedItemOverrides = {}
): FeedItem => makeUniqueFeedItem({ feedId, ...overrides });

export const pageRow = (owner = alice): SavedPage =>
  makeUniqueSavedPage({ ownerId: owner });

export const storedFeed = (
  owner = alice
): Effect.Effect<Feed, FeedRepositoryError, FeedRepository> =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const feed = makeUniqueFeed({ ownerId: owner });
    yield* feeds.create(owner, [feed]);

    return feed;
  });

export const storedFolder = (
  owner = alice
): Effect.Effect<Folder, FolderRepositoryError, FolderRepository> =>
  Effect.gen(function* () {
    const folders = yield* FolderRepository;
    const folder = makeUniqueFolder({ ownerId: owner });
    yield* folders.create(owner, [folder]);

    return folder;
  });

export const storedFolderFeed = (
  folderId: FolderId,
  owner = alice
): Effect.Effect<Feed, FeedRepositoryError, FeedRepository> =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const feed = folderFeedRow(folderId, owner);
    yield* feeds.create(owner, [feed]);

    return feed;
  });

export const idsOf = (
  rows: ReadonlyArray<{ readonly id: string }>
): Array<string> => rows.map((row) => row.id);

/** Ids in byte order, for a write whose result order the contract does not fix. */
export const sortedIds = (ids: ReadonlyArray<string>): Array<string> =>
  Array.from(ids).sort();

export const rowAt = <A>(rows: ReadonlyArray<A>, index: number): A => {
  const row = rows[index];

  if (row === undefined) {
    throw new Error(`no row at index ${index}`);
  }

  return row;
};

export const unreadCountFor = (
  counts: ReadonlyArray<FeedUnreadCount>,
  feedId: FeedId
): number => counts.find((count) => count.feedId === feedId)?.count ?? 0;

export const updatedTime = (): DateTime.Utc =>
  DateTime.fromDateUnsafe(new Date('2026-01-01T00:00:00.000Z'));

/** One instant of the Kindle schedule, the stored next send (KD-SCHED-1). */
export const sendAt = (iso: string): DateTime.Utc =>
  DateTime.fromDateUnsafe(new Date(iso));

export const feedItemQuery = (
  overrides: Partial<FeedItemQuery> = {}
): FeedItemQuery => ({
  limit: 10,
  unread: false,
  cursor: Option.none(),
  ...overrides,
});

export const savedPageQuery = (
  overrides: Partial<SavedPageQuery> = {}
): SavedPageQuery => ({
  limit: 10,
  unread: false,
  cursor: Option.none(),
  ...overrides,
});
