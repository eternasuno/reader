import { type DateTime, Effect, Layer, Option } from 'effect';
import type {
  ArticleContent,
  ArticleDescription,
} from '../../../src/entity/common/article';
import type { OwnerId } from '../../../src/entity/common/owner-id';
import type { FeedItem } from '../../../src/entity/feed/feed-item';
import type { SavedPage } from '../../../src/entity/saved-page/saved-page';
import {
  ArticleExtractor,
  type ExtractedArticle,
  type IArticleExtractor,
} from '../../../src/port/article-extractor';
import {
  FeedItemRepository,
  type FeedItemRepositoryError,
} from '../../../src/port/feed-item-repository';
import type {
  FeedRepository,
  FeedRepositoryError,
} from '../../../src/port/feed-repository';
import { HtmlParser, type IHtmlParser } from '../../../src/port/html-parser';
import {
  SavedPageRepository,
  type SavedPageRepositoryError,
} from '../../../src/port/saved-page-repository';
import {
  type IWebpageFetcher,
  WebpageFetcher,
} from '../../../src/port/webpage-fetcher';
import { FeedItemNotFound } from '../../../src/usecase/feed/errors';
import { SavedPageAlreadyExists } from '../../../src/usecase/saved-page/errors';
import {
  decodeContent,
  decodeDescription,
  decodeTitle,
  type FeedItemOverrides,
  makeFeedItem,
  parsedDocument,
  storedFeed,
  uniqueUrl,
} from '../fixtures';
import { MemoryFeedStoreLive } from '../memory/feed-store';
import { MemorySavedPageRepositoryLive } from '../memory/saved-page';

const pageHtml = '<html><body><p>Hello</p></body></html>';

const document = parsedDocument(pageHtml);

type ArticleOverrides = {
  readonly description?: Option.Option<ArticleDescription>;
  readonly content?: Option.Option<ArticleContent>;
  readonly publishedAt?: Option.Option<DateTime.Utc>;
};

export const fetchedArticle = (
  overrides: ArticleOverrides = {}
): ExtractedArticle => ({
  title: decodeTitle('Fetched'),
  description: decodeDescription('Fetched description'),
  content: decodeContent('<p>Fetched</p>'),
  publishedAt: Option.none(),
  ...overrides,
});

type SavedPageServices =
  | SavedPageRepository
  | FeedRepository
  | FeedItemRepository
  | WebpageFetcher
  | HtmlParser
  | ArticleExtractor;

type Doubles = {
  readonly fetch?: IWebpageFetcher['fetch'];
  readonly parse?: IHtmlParser['parse'];
  readonly extract?: IArticleExtractor['extract'];
};

const testLayer = (doubles: Doubles = {}): Layer.Layer<SavedPageServices> =>
  Layer.mergeAll(
    MemorySavedPageRepositoryLive,
    MemoryFeedStoreLive,
    Layer.mock(WebpageFetcher, {
      fetch: doubles.fetch ?? (() => Effect.succeed(pageHtml)),
    }),
    Layer.mock(HtmlParser, {
      parse: doubles.parse ?? (() => Effect.succeed(document)),
    }),
    Layer.mock(ArticleExtractor, {
      extract: doubles.extract ?? (() => Effect.succeed(fetchedArticle())),
    })
  );

export const run = <A, E>(
  effect: Effect.Effect<A, E, SavedPageServices>,
  doubles: Doubles = {}
): Effect.Effect<A, E> => effect.pipe(Effect.provide(testLayer(doubles)));

export const recordingFetch =
  (calls: Array<string>): IWebpageFetcher['fetch'] =>
  (href) => {
    calls.push(href);

    return Effect.succeed(pageHtml);
  };

export const storeFeedItem = (
  owner: OwnerId,
  overrides: FeedItemOverrides = {}
): Effect.Effect<
  FeedItem,
  FeedRepositoryError | FeedItemRepositoryError,
  FeedRepository | FeedItemRepository
> =>
  Effect.gen(function* () {
    const feed = yield* storedFeed(owner);
    const items = yield* FeedItemRepository;
    const item = makeFeedItem({
      ownerId: owner,
      feedId: feed.id,
      url: uniqueUrl('item'),
      ...overrides,
    });

    yield* items.create(owner, [item]);

    return item;
  });

export const storedPages = (
  owner: OwnerId,
  unreadOnly = false
): Effect.Effect<
  ReadonlyArray<SavedPage>,
  SavedPageRepositoryError,
  SavedPageRepository
> =>
  Effect.gen(function* () {
    const repository = yield* SavedPageRepository;

    return yield* repository.list(owner, { unreadOnly, limit: 100 });
  });

export const asAlreadyExists = (error: {
  readonly _tag: string;
}): SavedPageAlreadyExists => {
  if (!(error instanceof SavedPageAlreadyExists)) {
    throw new Error(`expected SavedPageAlreadyExists, got ${error._tag}`);
  }

  return error;
};

export const asNotFound = (error: {
  readonly _tag: string;
}): FeedItemNotFound => {
  if (!(error instanceof FeedItemNotFound)) {
    throw new Error(`expected FeedItemNotFound, got ${error._tag}`);
  }

  return error;
};
