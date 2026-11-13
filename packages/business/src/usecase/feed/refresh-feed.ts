import { DateTime, Effect, Option } from 'effect';
import type { HttpClient } from 'effect/http';
import {
  ArticleContent,
  ArticleDescription,
} from '../../entity/common/article';
import type { NormalizedUrl } from '../../entity/common/normalized-url';
import type { OwnerId } from '../../entity/common/owner-id';
import type { Feed, FeedId } from '../../entity/feed/feed';
import { FeedItem, type FeedItemId } from '../../entity/feed/feed-item';
import {
  DocumentSanitizer,
  type DocumentSanitizerError,
} from '../../port/document-sanitizer';
import {
  type FeedItemKey,
  FeedItemRepository,
  type FeedItemRepositoryError,
} from '../../port/feed-item-repository';
import type {
  FeedParser,
  FeedParserError,
  ParsedFeedEntry,
} from '../../port/feed-parser';
import {
  FeedRepository,
  type FeedRepositoryError,
} from '../../port/feed-repository';
import { HtmlParser, type HtmlParserError } from '../../port/html-parser';
import {
  SettingRepository,
  type SettingRepositoryError,
} from '../../port/setting-repository';
import type { FetchFeedError } from './errors';
import { fetchParsedFeed } from './fetch-parsed-feed';

export type Selection = {
  readonly toImport: ReadonlyArray<ParsedFeedEntry>;
  readonly toRemove: ReadonlyArray<FeedItemId>;
};

type CleanedEntry = {
  readonly description: Option.Option<string>;
  readonly content: Option.Option<string>;
};

export const selectItems = (
  inventory: ReadonlyArray<FeedItemKey>,
  entries: ReadonlyArray<ParsedFeedEntry>,
  retention: number
): Selection => {
  const listed: Array<ParsedFeedEntry> = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (listed.length >= retention) {
      break;
    }

    if (!seen.has(entry.url.href)) {
      seen.add(entry.url.href);
      listed.push(entry);
    }
  }

  const listedUrls = new Set(listed.map((entry) => entry.url.href));
  const storedUrls = new Set(inventory.map((item) => item.url.href));
  const toImport = listed.filter((entry) => !storedUrls.has(entry.url.href));
  const retained = inventory.filter((item) => listedUrls.has(item.url.href));
  const others = inventory.filter((item) => !listedUrls.has(item.url.href));
  const keptIds = new Set(
    [
      ...retained,
      ...others.slice(0, Math.max(retention - listed.length, 0)),
    ].map((item) => item.id)
  );

  return {
    toImport,
    toRemove: inventory
      .filter((item) => !keptIds.has(item.id))
      .map((item) => item.id),
  };
};

const cleanHtml = (
  text: Option.Option<string>,
  url: NormalizedUrl
): Effect.Effect<
  Option.Option<string>,
  HtmlParserError | DocumentSanitizerError,
  HtmlParser | DocumentSanitizer
> =>
  Effect.gen(function* () {
    if (Option.isNone(text)) {
      return Option.none<string>();
    }

    const parser = yield* HtmlParser;
    const sanitizer = yield* DocumentSanitizer;
    const sanitized = yield* Effect.scoped(
      Effect.gen(function* () {
        const document = yield* parser.parse(text.value, url);

        return yield* sanitizer.sanitize(document);
      })
    );

    return sanitized.pipe(
      Option.map((value) => value.trim()),
      Option.filter((value) => value !== '')
    );
  });

const cleanEntry = (
  entry: ParsedFeedEntry
): Effect.Effect<
  Option.Option<CleanedEntry>,
  never,
  HtmlParser | DocumentSanitizer
> =>
  Effect.gen(function* () {
    const description = yield* cleanHtml(entry.description, entry.url);
    const content = yield* cleanHtml(entry.content, entry.url);

    return Option.some({ description, content } satisfies CleanedEntry);
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning(
        'Skipping a feed entry that cannot be cleaned',
        entry.url.href,
        error
      ).pipe(Effect.as(Option.none<CleanedEntry>()))
    )
  );

const buildItem = (
  feed: Feed,
  entry: ParsedFeedEntry,
  cleaned: CleanedEntry
): Effect.Effect<FeedItem> =>
  FeedItem.makeEffect({
    ownerId: feed.ownerId,
    feedId: feed.id,
    url: entry.url,
    title: entry.title,
    description: Option.map(cleaned.description, (text) =>
      ArticleDescription.make(text)
    ),
    content: Option.map(cleaned.content, (text) => ArticleContent.make(text)),
    extractedContent: Option.none(),
    publishedAt: entry.publishedAt,
    read: false,
  }).pipe(Effect.orDie);

const buildItems = (feed: Feed, entries: ReadonlyArray<ParsedFeedEntry>) =>
  Effect.gen(function* () {
    const built: Array<FeedItem> = [];

    for (const entry of [...entries].reverse()) {
      const cleaned = yield* cleanEntry(entry);

      if (Option.isSome(cleaned)) {
        built.push(yield* buildItem(feed, entry, cleaned.value));
      }
    }

    return built;
  });

export const refreshFeed = (
  owner: OwnerId,
  feedId: FeedId
): Effect.Effect<
  void,
  | FetchFeedError
  | FeedParserError
  | FeedItemRepositoryError
  | FeedRepositoryError
  | SettingRepositoryError,
  | FeedRepository
  | FeedItemRepository
  | SettingRepository
  | HttpClient.HttpClient
  | FeedParser
  | HtmlParser
  | DocumentSanitizer
> =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const found = yield* feeds.find(owner, feedId);

    if (Option.isNone(found)) {
      return;
    }

    const feed = found.value;
    const parsed = yield* fetchParsedFeed(feed.url);
    const items = yield* FeedItemRepository;
    const settings = yield* SettingRepository;
    const inventory = yield* items.inventory(feed.ownerId, feed.id);
    const setting = yield* settings.get(feed.ownerId);
    const selection = selectItems(
      inventory,
      parsed.entries,
      setting.feed.retention
    );
    const built = yield* buildItems(feed, selection.toImport);

    if (built.length > 0) {
      yield* items.create(feed.ownerId, built);
    }

    if (selection.toRemove.length > 0) {
      yield* items.remove(feed.ownerId, selection.toRemove);
    }

    const now = yield* DateTime.now;

    yield* feeds.recordSync(feed.ownerId, feed.id, parsed.title, now);
  });
