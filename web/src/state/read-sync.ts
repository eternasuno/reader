/**
 * Per-article serialized read-state sync (`LIB-READ-1`, `LIB-READ-2`). The store always shows the
 * user's latest intent; each article has at most one request in flight, and rapid toggles coalesce
 * into the next request. A failure restores the last server-confirmed value only while the intent
 * is still the failed value. Solid optimistic APIs are not used (see `upstream-issues.md`).
 */

import { flush } from 'solid-js';
import { feedItemsApi, savedPagesApi } from '../api';
import { showToast } from '../ui';
import { errorText } from './errorText';
import type { LibraryArticle } from './library-store';
import { patchArticle } from './library-store';
import { onSessionCleared } from './session';
import * as sidebar from './sidebar';

/** Read-state context of one article as currently shown. */
export interface ReadTarget {
  id: string;
  kind: LibraryArticle['kind'];
  feedId: string | null;
  read: boolean;
}

interface ReadEntry {
  kind: LibraryArticle['kind'];
  feedId: string | null;
  /** Last server-confirmed value. */
  confirmed: boolean;
  /** The user's latest intent; what the store shows. */
  desired: boolean;
  inflight: boolean;
  /** Latest snapshot request dispatched before the last settle; the entry is held until it lands. */
  holdUntil: number;
  /** Resolved with the confirmed value once the queue is idle, or `null` after a session clear. */
  waiters: Array<(confirmed: boolean | null) => void>;
}

/** Outcome of a batch request, or `null` when the session was cleared meanwhile. */
export type ReadBatchResult =
  | { ok: true }
  | { ok: false; error: unknown; reverted: number };

const entries = new Map<string, ReadEntry>();
let epoch = 0;
let snapshotSeq = 0;
const activeSnapshots = new Set<number>();

const isHeld = (entry: ReadEntry): boolean => {
  for (const id of activeSnapshots) {
    if (id <= entry.holdUntil) return true;
  }
  return false;
};

const isIdle = (entry: ReadEntry): boolean =>
  !entry.inflight && entry.desired === entry.confirmed;

/**
 * Marks a server snapshot request (list page or article detail) in flight. Read state settled
 * while it is pending keeps overriding its stale value; call the returned release after the
 * snapshot has been merged into the store.
 */
export const beginRecordSnapshot = (): (() => void) => {
  snapshotSeq += 1;
  const id = snapshotSeq;
  activeSnapshots.add(id);
  return () => {
    activeSnapshots.delete(id);
    for (const [articleId, entry] of entries) {
      if (isIdle(entry) && !isHeld(entry)) entries.delete(articleId);
    }
  };
};

export const targetOf = (article: LibraryArticle): ReadTarget => ({
  id: article.id,
  kind: article.kind,
  feedId: article.kind === 'feed' ? article.feedId : null,
  read: article.read,
});

/** The user's pending read intent for an article, or `undefined` when nothing is pending. */
export const pendingRead = (articleId: string): boolean | undefined =>
  entries.get(articleId)?.desired;

const ensureEntry = (target: ReadTarget): ReadEntry => {
  const existing = entries.get(target.id);
  if (existing !== undefined) return existing;

  const entry: ReadEntry = {
    kind: target.kind,
    feedId: target.feedId,
    confirmed: target.read,
    desired: target.read,
    inflight: false,
    holdUntil: 0,
    waiters: [],
  };
  entries.set(target.id, entry);
  return entry;
};

const adjustUnread = (entry: ReadEntry, read: boolean): void => {
  const delta = read ? -1 : 1;
  if (entry.kind === 'later') {
    sidebar.adjustSavedUnread(delta);
  } else if (entry.feedId !== null) {
    sidebar.adjustFeedUnread(entry.feedId, delta);
  }
};

/** Shows `read` in the store and, when asked, moves the unread counts by the displayed delta. */
const show = (id: string, read: boolean, adjustCounts: boolean): void => {
  const entry = entries.get(id);
  if (entry === undefined || entry.desired === read) return;
  entry.desired = read;
  patchArticle(id, { read });
  if (adjustCounts) adjustUnread(entry, read);
};

const sendRead = async (
  kind: LibraryArticle['kind'],
  id: string,
  read: boolean
): Promise<void> => {
  if (kind === 'later') {
    await savedPagesApi.setRead(id, read);
  } else {
    await feedItemsApi.setRead(id, read);
  }
};

/** Records a settled request; returns whether the shown value was restored to `confirmed`. */
const settle = (
  id: string,
  sent: boolean,
  ok: boolean,
  adjustCounts: boolean
): boolean => {
  const entry = entries.get(id);
  if (entry === undefined) return false;
  entry.inflight = false;
  entry.holdUntil = snapshotSeq;
  if (ok) {
    entry.confirmed = sent;
    return false;
  }
  if (entry.desired !== sent) return false;

  show(id, entry.confirmed, adjustCounts);
  return true;
};

const finishSingle = (
  id: string,
  entry: ReadEntry,
  sent: boolean,
  sentEpoch: number,
  error: { value: unknown } | null
): void => {
  if (sentEpoch !== epoch || entries.get(id) !== entry) return;

  if (settle(id, sent, error === null, true)) {
    flush();
    showToast(errorText(error?.value), 'error');
  }
  pump(id);
};

/** Sends the next request for an article, or retires its entry once intent matches the server. */
const pump = (id: string): void => {
  const entry = entries.get(id);
  if (entry === undefined || entry.inflight) return;

  if (entry.desired === entry.confirmed) {
    const waiters = entry.waiters.splice(0);
    if (!isHeld(entry)) entries.delete(id);
    for (const resolve of waiters) resolve(entry.confirmed);
    return;
  }

  const sent = entry.desired;
  const sentEpoch = epoch;
  entry.inflight = true;
  void sendRead(entry.kind, id, sent).then(
    () => finishSingle(id, entry, sent, sentEpoch, null),
    (error: unknown) =>
      finishSingle(id, entry, sent, sentEpoch, { value: error })
  );
};

/**
 * Applies one read intent: shows it, moves the unread counts, and queues the request. Resolves
 * with the confirmed value once the article's queue is idle (`null` after a session clear).
 */
export const requestRead = (
  target: ReadTarget,
  read: boolean
): Promise<boolean | null> => {
  const entry = ensureEntry(target);
  const settled = new Promise<boolean | null>((resolve) => {
    entry.waiters.push(resolve);
  });
  show(target.id, read, true);
  flush();
  pump(target.id);
  return settled;
};

const beginBatch = (
  targets: ReadonlyArray<ReadTarget>,
  adjustCounts: boolean
): Array<[string, ReadEntry]> => {
  const owned: Array<[string, ReadEntry]> = [];
  for (const target of targets) {
    const entry = ensureEntry(target);
    show(target.id, true, adjustCounts);
    if (entry.inflight) continue;
    entry.inflight = true;
    owned.push([target.id, entry]);
  }
  flush();
  return owned;
};

const settleBatch = (
  owned: ReadonlyArray<[string, ReadEntry]>,
  ok: boolean,
  adjustCounts: boolean
): number => {
  let reverted = 0;
  for (const [id, entry] of owned) {
    if (entries.get(id) !== entry) continue;
    if (settle(id, true, ok, adjustCounts)) reverted += 1;
  }
  flush();
  for (const [id] of owned) pump(id);
  return reverted;
};

/**
 * Marks `targets` read under one batch request. Articles with their own request in flight are
 * shown read but left to their own queue. `adjustCounts: false` leaves the unread counts to the
 * caller (scope-wide mark-all clears them wholesale).
 */
export const runReadBatch = async (
  targets: ReadonlyArray<ReadTarget>,
  adjustCounts: boolean,
  send: () => Promise<void>
): Promise<ReadBatchResult | null> => {
  const sentEpoch = epoch;
  const owned = beginBatch(targets, adjustCounts);
  try {
    await send();
  } catch (error) {
    if (sentEpoch !== epoch) return null;
    const reverted = settleBatch(owned, false, adjustCounts);
    return { ok: false, error, reverted };
  }
  if (sentEpoch !== epoch) return null;
  settleBatch(owned, true, adjustCounts);
  return { ok: true };
};

export const clearReadSyncState = (): void => {
  epoch += 1;
  activeSnapshots.clear();
  const cleared = [...entries.values()];
  entries.clear();
  for (const entry of cleared) {
    for (const resolve of entry.waiters) resolve(null);
  }
};

onSessionCleared(clearReadSyncState);
