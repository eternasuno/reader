import { Effect, Option } from 'effect';
import type { ArticleContent } from '../../entity/common/article';
import type { OwnerId } from '../../entity/common/owner-id';
import type { FeedItem, FeedItemId } from '../../entity/feed/feed-item';
import { SavedPage } from '../../entity/saved-page/saved-page';
import type {
  ArticleExtractor,
  ArticleExtractorError,
} from '../../port/article-extractor';
import {
  FeedItemRepository,
  type FeedItemRepositoryError,
} from '../../port/feed-item-repository';
import type { HtmlParser, HtmlParserError } from '../../port/html-parser';
import {
  SavedPageRepository,
  type SavedPageRepositoryError,
} from '../../port/saved-page-repository';
import type {
  WebpageFetcher,
  WebpageFetcherError,
} from '../../port/webpage-fetcher';
import type { ArticleEmptyContent } from '../common/errors';
import { fetchAndExtract } from '../common/fetch-and-extract';
import { FeedItemNotFound } from '../feed/errors';
import { SavedPageAlreadyExists } from './errors';

type SaveErrors =
  | FeedItemNotFound
  | SavedPageAlreadyExists
  | FeedItemRepositoryError
  | SavedPageRepositoryError
  | WebpageFetcherError
  | HtmlParserError
  | ArticleExtractorError
  | ArticleEmptyContent;

type SaveServices =
  | FeedItemRepository
  | SavedPageRepository
  | WebpageFetcher
  | HtmlParser
  | ArticleExtractor;

const chooseContent = (
  item: FeedItem
): Effect.Effect<
  ArticleContent,
  | WebpageFetcherError
  | HtmlParserError
  | ArticleExtractorError
  | ArticleEmptyContent,
  WebpageFetcher | HtmlParser | ArticleExtractor
> =>
  Effect.gen(function* () {
    const stored = Option.firstSomeOf([item.extractedContent, item.content]);

    if (Option.isSome(stored)) {
      return stored.value;
    }

    const article = yield* fetchAndExtract(item.url);

    return article.content;
  });

export const saveFeedItem = (
  owner: OwnerId,
  itemId: FeedItemId
): Effect.Effect<SavedPage, SaveErrors, SaveServices> =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const found = yield* items.find(owner, itemId);

    if (Option.isNone(found)) {
      return yield* new FeedItemNotFound({ id: itemId });
    }

    const item = found.value;
    const pages = yield* SavedPageRepository;
    const existing = yield* pages.findByUrl(owner, item.url);

    if (Option.isSome(existing)) {
      return yield* new SavedPageAlreadyExists({ url: item.url });
    }

    const content = yield* chooseContent(item);
    const page = yield* SavedPage.makeEffect({
      ownerId: owner,
      url: item.url,
      title: item.title,
      description: item.description,
      content,
      publishedAt: item.publishedAt,
      read: false,
    }).pipe(Effect.orDie);
    const created = yield* pages.create(owner, [page]);

    if (created.length === 0) {
      return yield* new SavedPageAlreadyExists({ url: item.url });
    }

    return page;
  });
