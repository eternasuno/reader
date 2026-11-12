import { Effect, Option } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { FeedItem, FeedItemId } from '../../entity/feed/feed-item';
import type {
  ArticleExtractor,
  ArticleExtractorError,
} from '../../port/article-extractor';
import {
  FeedItemRepository,
  type FeedItemRepositoryError,
} from '../../port/feed-item-repository';
import type { HtmlParser, HtmlParserError } from '../../port/html-parser';
import type {
  WebpageFetcher,
  WebpageFetcherError,
} from '../../port/webpage-fetcher';
import type { ArticleEmptyContent } from '../common/errors';
import {
  type FetchedArticle,
  fetchAndExtract,
} from '../common/fetch-and-extract';
import { FeedItemNotFound } from './errors';

const storeExtracted = (
  owner: OwnerId,
  item: FeedItem,
  article: FetchedArticle
): Effect.Effect<
  FeedItem,
  FeedItemNotFound | FeedItemRepositoryError,
  FeedItemRepository
> =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const extractedContent = Option.some(article.content);
    const updated = yield* items.update(owner, [item.id], { extractedContent });

    if (updated.length === 0) {
      return yield* new FeedItemNotFound({ id: item.id });
    }

    return { ...item, extractedContent };
  });

export const extractItem = (
  owner: OwnerId,
  id: FeedItemId
): Effect.Effect<
  FeedItem,
  | FeedItemNotFound
  | FeedItemRepositoryError
  | ArticleEmptyContent
  | WebpageFetcherError
  | HtmlParserError
  | ArticleExtractorError,
  FeedItemRepository | WebpageFetcher | HtmlParser | ArticleExtractor
> =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const found = yield* items.find(owner, id);

    if (Option.isNone(found)) {
      return yield* new FeedItemNotFound({ id });
    }

    if (Option.isSome(found.value.extractedContent)) {
      return found.value;
    }

    const article = yield* fetchAndExtract(found.value.url);

    return yield* storeExtracted(owner, found.value, article);
  });
