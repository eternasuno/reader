import type { ParsedFeedEntry } from '../../../entity/feed/feed';
import type { FeedItemId } from '../../../entity/feed-item/feed-item';
import type { FeedItemKey } from '../../../port/feed-item-repository';

/** The result of the selection: entries to import in source order and ids to delete (FD-SEL-8). */
export type Selection = {
  readonly toImport: ReadonlyArray<ParsedFeedEntry>;
  readonly toRemove: ReadonlyArray<FeedItemId>;
};

/** The first `retention` distinct entries in source order; equal URLs collapse to the first (FD-SEL-1, FD-SEL-6). */
const listedEntries = (
  entries: ReadonlyArray<ParsedFeedEntry>,
  retention: number
): ReadonlyArray<ParsedFeedEntry> => {
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

  return listed;
};

/**
 * The stored items that stay: the listed ones, plus the other stored items
 * taken in list order from the top until N in total, every listed entry
 * counting toward N (FD-SEL-3).
 */
const keptItemIds = (
  inventory: ReadonlyArray<FeedItemKey>,
  listedUrls: ReadonlySet<string>,
  spare: number
): ReadonlySet<FeedItemId> => {
  const kept = new Set<FeedItemId>(
    inventory
      .filter((item) => listedUrls.has(item.url.href))
      .map((item) => item.id)
  );
  let remaining = spare;

  for (const item of inventory) {
    if (remaining <= 0) {
      break;
    }

    if (!listedUrls.has(item.url.href)) {
      kept.add(item.id);
      remaining -= 1;
    }
  }

  return kept;
};

/**
 * Selects what a sync imports and what it deletes: a pure function of the
 * inventory, the entries in source order and N, the owner's retention
 * (FD-SEL-8). Read state plays no role (FD-SEL-4), and an item the source no
 * longer lists stays while spare room is left (FD-SEL-5).
 */
export const selectItems = (
  inventory: ReadonlyArray<FeedItemKey>,
  entries: ReadonlyArray<ParsedFeedEntry>,
  retention: number
): Selection => {
  const listed = listedEntries(entries, retention);
  const listedUrls = new Set(listed.map((entry) => entry.url.href));
  const storedUrls = new Set(inventory.map((item) => item.url.href));
  const kept = keptItemIds(inventory, listedUrls, retention - listed.length);

  return {
    toImport: listed.filter((entry) => !storedUrls.has(entry.url.href)),
    toRemove: inventory
      .filter((item) => !kept.has(item.id))
      .map((item) => item.id),
  };
};
