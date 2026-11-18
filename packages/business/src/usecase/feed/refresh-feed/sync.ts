import { DateTime, Effect } from 'effect';
import type { OwnerId } from '../../../entity/common/owner-id';
import type { Feed, ParsedFeed } from '../../../entity/feed/feed';
import type { FeedRepositoryError } from '../../../error/feed';
import type { FeedItemRepositoryError } from '../../../error/feed-item';
import type { SettingRepositoryError } from '../../../error/setting';
import type { DocumentSanitizer } from '../../../port/document-sanitizer';
import { FeedItemRepository } from '../../../port/feed-item-repository';
import { FeedRepository } from '../../../port/feed-repository';
import type { HtmlParser } from '../../../port/html-parser';
import { SettingRepository } from '../../../port/setting-repository';
import { buildEntries } from './import-entries';
import { selectItems } from './selection';

/**
 * Brings a feed's items in line with its source (FD-SYNC): read the inventory
 * and the owner's retention, select, build and create the entries to import,
 * remove the items the selection dropped and record the sync. Stored items are
 * never modified (FD-SYNC-1) and the clock is read once, for `updatedAt`
 * (CM-TIME-2).
 */
export const syncFeed = Effect.fnUntraced(function* (
  owner: OwnerId,
  feed: Feed,
  parsed: ParsedFeed
): Effect.fn.Return<
  void,
  FeedRepositoryError | FeedItemRepositoryError | SettingRepositoryError,
  | FeedRepository
  | FeedItemRepository
  | SettingRepository
  | HtmlParser
  | DocumentSanitizer
> {
  const items = yield* FeedItemRepository;
  const settings = yield* SettingRepository;
  const feeds = yield* FeedRepository;
  const inventory = yield* items.inventory(owner, feed.id);
  const setting = yield* settings.get(owner);
  const selection = selectItems(inventory, parsed.entries, setting.retention);
  const built = yield* buildEntries(feed, selection.toImport);

  if (built.length > 0) {
    yield* items.create(owner, built);
  }

  if (selection.toRemove.length > 0) {
    yield* items.remove(owner, selection.toRemove);
  }

  const now = yield* DateTime.now;

  yield* feeds.recordSync(owner, feed.id, parsed.title, now);
});
