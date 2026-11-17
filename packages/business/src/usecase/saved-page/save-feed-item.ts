import { Effect, Option } from 'effect';
import type { OwnerId } from '../../entity/common/owner-id';
import type { FeedItem, FeedItemId } from '../../entity/feed-item/feed-item';
import { SavedPage } from '../../entity/saved-page/saved-page';
import {
  FeedItemNotFound,
  type FeedItemRepositoryError,
} from '../../error/feed-item';
import {
  SavedPageAlreadyExists,
  type SavedPageRepositoryError,
} from '../../error/saved-page';
import { FeedItemRepository } from '../../port/feed-item-repository';
import { SavedPageRepository } from '../../port/saved-page-repository';
import {
  type FetchAndExtractError,
  type FetchAndExtractPorts,
  fetchAndExtract,
} from '../common/fetch-and-extract';

/**
 * The content of the copy (SP-SAVE-8): the item's extracted content, else its
 * feed content, else the content of the page fetched from the item's URL.
 * Nothing is fetched when the item has either stored content.
 */
const contentOf = Effect.fnUntraced(function* (item: FeedItem) {
  const stored = Option.firstSomeOf([item.extractedContent, item.content]);

  if (Option.isSome(stored)) {
    return stored.value;
  }

  const article = yield* fetchAndExtract(item.url);

  return article.content;
});

/**
 * Copies one feed item into the read-later list (SP-SAVE): the item is looked
 * up by owner and id only, without looking up its feed (SP-SAVE-1), a page that
 * already holds its URL fails before anything is fetched (SP-SAVE-3), and the
 * copy takes the item's title and description (SP-SAVE-2), its publish time or
 * none (SP-SAVE-5) and its URL (SP-SAVE-9). It gets a new id and is unread, so
 * it is on top of the later list (SP-SAVE-9). Saving changes neither side
 * (SP-SAVE-4) and succeeds even when the item is removed meanwhile (SP-SAVE-10);
 * a lost race to the unique URL fails as a duplicate (SP-SAVE-7).
 */
export const saveFeedItem = Effect.fn('saveFeedItem')(function* (
  owner: OwnerId,
  itemId: FeedItemId
) {
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

  const content = yield* contentOf(item);
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

/** The failures of one saved feed item (SP-SAVE-1, SP-SAVE-6, SP-SAVE-7). */
export type SaveFeedItemError =
  | FeedItemNotFound
  | SavedPageAlreadyExists
  | FeedItemRepositoryError
  | SavedPageRepositoryError
  | FetchAndExtractError;

/** The ports one saved feed item runs on (SP-SAVE). */
export type SaveFeedItemPorts =
  | FeedItemRepository
  | SavedPageRepository
  | FetchAndExtractPorts;
