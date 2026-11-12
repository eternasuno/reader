import type { DateTime } from 'effect';
import { Effect, Layer, Option } from 'effect';
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from 'effect/http';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import type { Feed, FeedId } from '../../../src/entity/feed/feed';
import { FeedTitle } from '../../../src/entity/feed/feed';
import type { FeedItem } from '../../../src/entity/feed/feed-item';
import {
  ArticleExtractor,
  type ExtractedArticle,
  type IArticleExtractor,
} from '../../../src/port/article-extractor';
import {
  DocumentSanitizer,
  type IDocumentSanitizer,
} from '../../../src/port/document-sanitizer';
import {
  FeedItemRepository,
  type FeedItemRepositoryError,
} from '../../../src/port/feed-item-repository';
import {
  FeedParser,
  type IFeedParser,
  type ParsedFeed,
  type ParsedFeedEntry,
  ParsedFeedEntry as ParsedFeedEntrySchema,
  ParsedFeed as ParsedFeedSchema,
} from '../../../src/port/feed-parser';
import {
  FeedRepository,
  type FeedRepositoryError,
} from '../../../src/port/feed-repository';
import { HtmlParser, type IHtmlParser } from '../../../src/port/html-parser';
import type { SettingRepository } from '../../../src/port/setting-repository';
import {
  type IWebpageFetcher,
  WebpageFetcher,
} from '../../../src/port/webpage-fetcher';
import { MemoryFeedStoreLive } from '../../port/memory-feed-store';
import { MemorySettingRepositoryLive } from '../../port/memory-setting-repository';
import {
  decodeContent,
  decodeTitle,
  decodeUrl,
  type FeedItemOverrides,
  makeFeedItem,
  makeUniqueFeed,
  parsedDocument,
} from '../../support';

export const defaultMaxTextLength = 100_000;

export type EntryOverrides = {
  readonly title?: string;
  readonly description?: Option.Option<string>;
  readonly content?: Option.Option<string>;
  readonly publishedAt?: Option.Option<DateTime.Utc>;
};

export const parsedEntry = (
  url: string,
  { title = 'Entry', ...rest }: EntryOverrides = {}
): ParsedFeedEntry =>
  ParsedFeedEntrySchema.make({
    title: decodeTitle(title),
    description: Option.none(),
    content: Option.none(),
    publishedAt: Option.none(),
    ...rest,
    url: decodeUrl(url),
  });

export type ParsedFeedOverrides = {
  readonly title?: string;
  readonly description?: Option.Option<string>;
  readonly entries?: ReadonlyArray<ParsedFeedEntry>;
};

export const parsedFeed = ({
  title = 'Parsed feed',
  ...rest
}: ParsedFeedOverrides = {}): ParsedFeed =>
  ParsedFeedSchema.make({
    title: FeedTitle.make(title),
    description: Option.none(),
    entries: [],
    ...rest,
  });

const htmlOf = (document: Document): string =>
  (document.body as unknown as { readonly innerHTML: string }).innerHTML;

export const defaultParseHtml: IHtmlParser['parse'] = (html) =>
  Effect.succeed(parsedDocument(html));

export const defaultSanitize: IDocumentSanitizer['sanitize'] = (document) =>
  Effect.succeedSome(htmlOf(document));

export const extractedArticle = (
  overrides: Partial<ExtractedArticle> = {}
): ExtractedArticle => ({
  title: decodeTitle('Extracted'),
  description: Option.none(),
  content: decodeContent('<p>Extracted</p>'),
  publishedAt: Option.none(),
  ...overrides,
});

export const defaultExtract: IArticleExtractor['extract'] = () =>
  Effect.succeed(extractedArticle());

export type FeedResponseOverrides = {
  readonly url?: string;
  readonly body?: string;
  readonly status?: number;
};

export const feedResponse = ({
  url = 'https://example.com/feed.xml',
  body = '<rss />',
  status = 200,
}: FeedResponseOverrides = {}): HttpClientResponse.HttpClientResponse =>
  HttpClientResponse.fromWeb(
    HttpClientRequest.get(url),
    new Response(body, { status })
  );

export const transportFailure = (url: URL): HttpClientError.HttpClientError =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({
      request: HttpClientRequest.get(url.href),
      cause: 'offline',
    }),
  });

type FeedFetch = (
  url: URL,
  request: HttpClientRequest.HttpClientRequest
) => Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  HttpClientError.HttpClientError
>;

const stubHttpClient = (fetchFeed: FeedFetch): HttpClient.HttpClient =>
  HttpClient.make((request, url) => fetchFeed(url, request));

const defaultFetchFeed: FeedFetch = (url) =>
  Effect.succeed(feedResponse({ url: url.href }));

export type Doubles = {
  readonly fetchFeed?: FeedFetch;
  readonly parseFeed?: IFeedParser['parse'];
  readonly fetchPage?: IWebpageFetcher['fetch'];
  readonly parseHtml?: IHtmlParser['parse'];
  readonly sanitize?: IDocumentSanitizer['sanitize'];
  readonly extract?: IArticleExtractor['extract'];
};

export type TestEnv =
  | FeedRepository
  | FeedItemRepository
  | SettingRepository
  | HttpClient.HttpClient
  | FeedParser
  | HtmlParser
  | DocumentSanitizer
  | WebpageFetcher
  | ArticleExtractor;

export const testLayer = (doubles: Doubles = {}) =>
  Layer.mergeAll(
    MemoryFeedStoreLive,
    MemorySettingRepositoryLive,
    Layer.succeed(
      HttpClient.HttpClient,
      stubHttpClient(doubles.fetchFeed ?? defaultFetchFeed)
    ),
    Layer.mock(FeedParser, {
      parse: doubles.parseFeed ?? (() => Effect.succeed(parsedFeed())),
    }),
    Layer.mock(HtmlParser, { parse: doubles.parseHtml ?? defaultParseHtml }),
    Layer.mock(DocumentSanitizer, {
      sanitize: doubles.sanitize ?? defaultSanitize,
    }),
    Layer.mock(WebpageFetcher, {
      fetch: doubles.fetchPage ?? (() => Effect.succeed('<p>Page</p>')),
    }),
    Layer.mock(ArticleExtractor, {
      extract: doubles.extract ?? defaultExtract,
    })
  );

export const run = <A, E>(
  effect: Effect.Effect<A, E, TestEnv>,
  doubles: Doubles = {}
): Effect.Effect<A, E> => Effect.provide(effect, testLayer(doubles));

export const itemFor = (feed: Feed, url: string): FeedItem =>
  makeFeedItem({ ownerId: feed.ownerId, feedId: feed.id, url: decodeUrl(url) });

export const storeFeed = (
  feed: Feed
): Effect.Effect<void, FeedRepositoryError, FeedRepository> =>
  Effect.flatMap(FeedRepository, (feeds) =>
    Effect.asVoid(feeds.create(feed.ownerId, [feed]))
  );

export const storeFeedWithItem = (
  overrides: FeedItemOverrides = {}
): Effect.Effect<
  { readonly feed: Feed; readonly item: FeedItem },
  FeedRepositoryError | FeedItemRepositoryError,
  FeedRepository | FeedItemRepository
> =>
  Effect.gen(function* () {
    const feed = makeUniqueFeed({});
    const item = makeFeedItem({
      ownerId: feed.ownerId,
      feedId: feed.id,
      ...overrides,
    });

    yield* storeFeed(feed);
    yield* storeItems(feed.ownerId, [item]);

    return { feed, item };
  });

export const storeItems = (
  owner: OwnerId,
  items: ReadonlyArray<FeedItem>
): Effect.Effect<void, FeedItemRepositoryError, FeedItemRepository> =>
  Effect.flatMap(FeedItemRepository, (store) =>
    Effect.asVoid(store.create(owner, items))
  );

export const findFeed = (
  owner: OwnerId,
  id: FeedId
): Effect.Effect<Option.Option<Feed>, FeedRepositoryError, FeedRepository> =>
  Effect.flatMap(FeedRepository, (feeds) => feeds.find(owner, id));

export const storedItems = (
  owner: OwnerId,
  feedId: FeedId
): Effect.Effect<
  ReadonlyArray<FeedItem>,
  FeedItemRepositoryError,
  FeedItemRepository
> =>
  Effect.flatMap(FeedItemRepository, (store) =>
    store.list(owner, { feedId, unreadOnly: false, limit: 1000 })
  );

export const allItems = (
  owner: OwnerId
): Effect.Effect<
  ReadonlyArray<FeedItem>,
  FeedItemRepositoryError,
  FeedItemRepository
> =>
  Effect.flatMap(FeedItemRepository, (store) =>
    store.list(owner, { unreadOnly: false, limit: 1000 })
  );

export const storedFeeds = (
  owner: OwnerId
): Effect.Effect<ReadonlyArray<Feed>, FeedRepositoryError, FeedRepository> =>
  Effect.flatMap(FeedRepository, (feeds) => feeds.list(owner));

export const rowAt = <Row>(rows: ReadonlyArray<Row>, index: number): Row => {
  const row = rows[index];

  if (row === undefined) {
    throw new Error(`missing row at index ${index}`);
  }

  return row;
};

export const urlsOf = (
  rows: ReadonlyArray<{ readonly url: URL }>
): ReadonlyArray<string> => rows.map((row) => row.url.href);
