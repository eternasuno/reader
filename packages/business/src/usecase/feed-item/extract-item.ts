import { Effect, Option } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { FeedItem, FeedItemId } from '../../entity/feed-item/feed-item';
import {
  FeedItemNotFound,
  type FeedItemRepositoryError,
} from '../../error/feed-item';
import { FeedItemRepository } from '../../port/feed-item-repository';
import {
  type FetchAndExtractError,
  type FetchAndExtractPorts,
  type FetchedArticle,
  fetchAndExtract,
} from '../common/fetch-and-extract';

/**
 * Stores the extracted content and returns the item with it (FD-EXTRACT step
 * 4): `setExtractedContent` tells a stored item from one that vanished
 * meanwhile, and a vanished item fails `FeedItemNotFound` (CM-PORT-5).
 */
const storeExtracted = Effect.fnUntraced(function* (
  owner: OwnerId,
  item: FeedItem,
  article: FetchedArticle
) {
  const items = yield* FeedItemRepository;
  const written = yield* items.setExtractedContent(
    owner,
    item.id,
    article.content
  );

  if (!written) {
    return yield* new FeedItemNotFound({ id: item.id });
  }

  return { ...item, extractedContent: Option.some(article.content) };
});

/**
 * Extracts one item's article (FD-EXTRACT): an item that does not exist for
 * the owner fails `FeedItemNotFound` before anything is fetched (FD-EXTRACT
 * step 1), a stored extraction is returned without fetching (FD-EXTRACT step 2,
 * FD-EXTRACT-2), otherwise the page is fetched and extracted (CM-FETCH) and the
 * content is stored. An extraction failure or empty content stores nothing
 * (FD-EXTRACT-1); two concurrent extractions may both fetch and the last write
 * wins (FD-EXTRACT-2).
 */
export const extractItem = Effect.fn('extractItem')(function* (
  owner: OwnerId,
  id: FeedItemId
) {
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

/** The failures of one extraction (FD-EXTRACT, FD-EXTRACT-1). */
export type ExtractItemError =
  | FeedItemNotFound
  | FeedItemRepositoryError
  | FetchAndExtractError;

/** The ports one extraction runs on (FD-EXTRACT). */
export type ExtractItemPorts = FeedItemRepository | FetchAndExtractPorts;
