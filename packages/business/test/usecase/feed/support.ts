import { type DateTime, Effect, Layer, Option } from 'effect';
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from 'effect/http';
import { ArticleContent } from '../../../src/entity/common/article';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import {
  type Feed,
  type FeedId,
  FeedTitle,
  type ParsedFeed,
  type ParsedFeedEntry,
  ParsedFeedEntry as ParsedFeedEntrySchema,
  ParsedFeed as ParsedFeedSchema,
} from '../../../src/entity/feed/feed';
import type { FeedItem } from '../../../src/entity/feed-item/feed-item';
import type { FeedRepositoryError } from '../../../src/error/feed';
import type { FeedItemRepositoryError } from '../../../src/error/feed-item';
import {
  DocumentSanitizer,
  type IDocumentSanitizer,
} from '../../../src/port/document-sanitizer';
import { FeedItemRepository } from '../../../src/port/feed-item-repository';
import { FeedParser, type IFeedParser } from '../../../src/port/feed-parser';
import { FeedRepository } from '../../../src/port/feed-repository';
import type { FolderRepository } from '../../../src/port/folder-repository';
import {
  HtmlDocument,
  HtmlParser,
  type IHtmlParser,
} from '../../../src/port/html-parser';
import type { SettingRepository } from '../../../src/port/setting-repository';
import { decodeTitle, decodeUrl, makeFeedItem } from '../../support/fixtures';
import {
  MemoryFeedStoreLive,
  memoryFeedStoreLayer,
} from '../../support/memory/feed-store';
import { MemorySettingRepositoryLive } from '../../support/memory/setting';

type EntryOverrides = {
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

type ParsedFeedOverrides = {
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

/**
 * The doubles keep a document as its HTML text: `HtmlDocument` is opaque to
 * business, so a test passes its own value through the two ports.
 */
export const documentText = (document: HtmlDocument): string =>
  // The double's document is the string it was parsed from.
  String(document);

export const defaultParseHtml: IHtmlParser['parse'] = (html) =>
  Effect.succeed(HtmlDocument.make(html));

/** Sanitizing keeps the text as it is and turns blank text into none (CM-HTML-2). */
export const defaultSanitize: IDocumentSanitizer['sanitize'] = (document) => {
  const text = documentText(document).trim();

  return Effect.succeed(
    text === ''
      ? Option.none<ArticleContent>()
      : Option.some(ArticleContent.make(text))
  );
};

type FeedResponseOverrides = {
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

export type FeedFetch = (
  url: URL,
  request: HttpClientRequest.HttpClientRequest
) => Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  HttpClientError.HttpClientError
>;

const defaultFetchFeed: FeedFetch = (url) =>
  Effect.succeed(feedResponse({ url: url.href }));

const stubHttpClient = (fetchFeed: FeedFetch): HttpClient.HttpClient =>
  HttpClient.make((request, url) => fetchFeed(url, request));

export type Doubles = {
  readonly fetchFeed?: FeedFetch;
  readonly parseFeed?: IFeedParser['parse'];
  readonly parseHtml?: IHtmlParser['parse'];
  readonly sanitize?: IDocumentSanitizer['sanitize'];
};

export type FeedStore = Layer.Layer<
  FeedRepository | FeedItemRepository | FolderRepository
>;

type TestEnv =
  | FeedRepository
  | FeedItemRepository
  | FolderRepository
  | SettingRepository
  | HttpClient.HttpClient
  | FeedParser
  | HtmlParser
  | DocumentSanitizer;

export const testLayer = (
  doubles: Doubles = {},
  store: FeedStore = MemoryFeedStoreLive
): Layer.Layer<TestEnv> =>
  Layer.mergeAll(
    store,
    MemorySettingRepositoryLive,
    Layer.succeed(
      HttpClient.HttpClient,
      stubHttpClient(doubles.fetchFeed ?? defaultFetchFeed)
    ),
    Layer.mock(FeedParser, {
      parse: doubles.parseFeed ?? (() => Effect.succeed(parsedFeed())),
    }),
    Layer.mock(HtmlParser, {
      parse: doubles.parseHtml ?? defaultParseHtml,
    }),
    Layer.mock(DocumentSanitizer, {
      sanitize: doubles.sanitize ?? defaultSanitize,
    })
  );

export const run = <A, E>(
  effect: Effect.Effect<A, E, TestEnv>,
  doubles: Doubles = {},
  store?: FeedStore
): Effect.Effect<A, E> => Effect.provide(effect, testLayer(doubles, store));

/** The feed store whose item repository is decorated, to observe or change what a sync writes. */
export const decoratedStore = memoryFeedStoreLayer;

export const storeFeed = (
  feed: Feed
): Effect.Effect<void, FeedRepositoryError, FeedRepository> =>
  Effect.flatMap(FeedRepository, (feeds) =>
    Effect.asVoid(feeds.create(feed.ownerId, [feed]))
  );

export const storedItems = (
  owner: OwnerId,
  feedId: FeedId
): Effect.Effect<
  ReadonlyArray<FeedItem>,
  FeedItemRepositoryError,
  FeedItemRepository
> =>
  Effect.flatMap(FeedItemRepository, (items) =>
    items.listByFeed(owner, feedId, {
      limit: Number.MAX_SAFE_INTEGER,
      unread: false,
      cursor: Option.none(),
    })
  );

/** Stores items so that the given order is the stored list order, newest first (FD-LIST-4). */
export const storeItemsInListOrder = (
  feed: Feed,
  urls: ReadonlyArray<string>
): Effect.Effect<void, FeedItemRepositoryError, FeedItemRepository> =>
  Effect.flatMap(FeedItemRepository, (items) =>
    Effect.asVoid(
      items.create(
        feed.ownerId,
        Array.from(urls)
          .reverse()
          .map((url) =>
            makeFeedItem({
              ownerId: feed.ownerId,
              feedId: feed.id,
              url: decodeUrl(url),
            })
          )
      )
    )
  );

export const urlsOf = (
  rows: ReadonlyArray<{ readonly url: URL }>
): Array<string> => rows.map((row) => row.url.href);

export const titlesOf = (
  rows: ReadonlyArray<{ readonly title: string }>
): Array<string> => rows.map((row) => row.title);
