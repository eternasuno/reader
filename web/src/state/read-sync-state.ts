/**
 * Shared entry registry, snapshot sequence stamps, and store display patching for `read-sync.ts`.
 */

import type { LibraryArticle } from './library-store';
import { patchArticle } from './library-store';
import * as sidebar from './sidebar';

/** Read-state context of one article as currently shown. */
export interface ReadTarget {
  id: string;
  kind: LibraryArticle['kind'];
  feedId: string | null;
  read: boolean;
}

export interface BarrierTarget {
  id: string;
  kind: LibraryArticle['kind'];
  feedId: string | null;
}

export type BarrierOutcome = 'ok' | 'failed' | 'ambiguous';
export type EnqueueBarrierResult = BarrierOutcome | 'cleared';

export interface ReadBarrier {
  /**
   * Rows the barrier's server write covers. Read at settlement and by later snapshot merges, so the
   * barrier closes over the boundary it resolved while executing.
   */
  affects: (entry: BarrierTarget) => boolean;
  execute: () => Promise<BarrierOutcome>;
}

export interface RecordSnapshotToken {
  seq: number;
  release: () => void;
}

export interface ReadEntry {
  kind: LibraryArticle['kind'];
  feedId: string | null;
  /** Last server-confirmed value; only trusted while `confirmedKnown`. */
  confirmed: boolean;
  /** False after an affecting ambiguous barrier until a write or fresh snapshot settles the value. */
  confirmedKnown: boolean;
  /** Latest queued intent, else `confirmed`; always what the store displays. */
  display: boolean;
  inflight: boolean;
  queuedCount: number;
  /** Sequence stamp when the latest write or affecting barrier settled. */
  settledAt: number;
  /** Resolved with confirmed value once the article has no queued/in-flight intent, or `null`. */
  waiters: Array<(confirmed: boolean | null) => void>;
}

export interface IntentItem {
  type: 'intent';
  id: string;
  read: boolean;
}

export interface BarrierItem {
  type: 'barrier';
  barrier: ReadBarrier;
  resolve: (result: EnqueueBarrierResult) => void;
}

export type QueueItem = IntentItem | BarrierItem;

/**
 * A successful barrier that settled while snapshots were in flight. Snapshots dispatched before
 * `seq` must not restore the pre-barrier `read` of rows without an entry. Released with the
 * snapshots older than `seq`.
 */
interface BarrierStamp {
  seq: number;
  affects: ReadBarrier['affects'];
}

export const entries = new Map<string, ReadEntry>();
export const queue: Array<QueueItem> = [];
export const activeSnapshots = new Set<number>();
export const barrierStamps: Array<BarrierStamp> = [];
export const ambiguousIds = new Set<string>();
export const drainListeners = new Set<() => void>();

export const queueState = {
  epoch: 0,
  seq: 0,
  mutationEpoch: 0,
  dispatching: false,
  activeBarrier: null as BarrierItem | null,
};

export const clock = (): number => {
  queueState.seq += 1;
  return queueState.seq;
};

export const isEntryIdle = (entry: ReadEntry): boolean =>
  !entry.inflight && entry.queuedCount === 0;

const hasOlderActiveSnapshot = (settledSeq: number): boolean => {
  for (const tokenSeq of activeSnapshots) {
    if (tokenSeq < settledSeq) return true;
  }
  return false;
};

const isRetirable = (entry: ReadEntry): boolean =>
  isEntryIdle(entry) &&
  entry.confirmedKnown &&
  !hasOlderActiveSnapshot(entry.settledAt);

const retireBarrierStamps = (): void => {
  for (let i = barrierStamps.length - 1; i >= 0; i -= 1) {
    if (!hasOlderActiveSnapshot(barrierStamps[i].seq))
      barrierStamps.splice(i, 1);
  }
};

/** Drops entries and barrier stamps that no in-flight snapshot still needs. */
const retireSettledState = (): void => {
  for (const [id, entry] of entries) {
    if (isRetirable(entry)) entries.delete(id);
  }
  retireBarrierStamps();
};

export const resolveWaiters = (id: string, entry: ReadEntry): void => {
  if (!isEntryIdle(entry)) return;
  const value = entry.confirmedKnown ? entry.confirmed : null;
  for (const resolve of entry.waiters.splice(0)) resolve(value);
  if (isRetirable(entry)) entries.delete(id);
};

/** Marks a server snapshot GET in flight; pass `token.seq` into store merges. */
export const beginRecordSnapshot = (): RecordSnapshotToken => {
  const tokenSeq = clock();
  activeSnapshots.add(tokenSeq);
  return {
    seq: tokenSeq,
    release: () => {
      activeSnapshots.delete(tokenSeq);
      retireSettledState();
    },
  };
};

export const targetOf = (article: LibraryArticle): ReadTarget => ({
  id: article.id,
  kind: article.kind,
  feedId: article.kind === 'feed' ? article.feedId : null,
  read: article.read,
});

/** True when an ok barrier covering `target` settled after `snapshotSeq`. */
const isBehindBarrier = (target: BarrierTarget, snapshotSeq: number): boolean =>
  barrierStamps.some(
    (stamp) => stamp.seq > snapshotSeq && stamp.affects(target)
  );

/** Merges an incoming snapshot record's read flag using the snapshot's dispatch sequence stamp. */
export const mergeSnapshotRead = (
  incoming: LibraryArticle,
  snapshotSeq?: number
): boolean => {
  const entry = entries.get(incoming.id);
  if (entry === undefined) {
    return snapshotSeq !== undefined &&
      isBehindBarrier(targetOf(incoming), snapshotSeq)
      ? true
      : incoming.read;
  }
  if (
    !entry.inflight &&
    snapshotSeq !== undefined &&
    snapshotSeq >= entry.settledAt
  ) {
    entry.confirmed = incoming.read;
    entry.confirmedKnown = true;
    if (entry.queuedCount === 0) entry.display = incoming.read;
  }
  return entry.display;
};

export const ensureEntry = (target: ReadTarget): ReadEntry => {
  const existing = entries.get(target.id);
  if (existing !== undefined) return existing;
  const entry: ReadEntry = {
    kind: target.kind,
    feedId: target.feedId,
    confirmed: target.read,
    confirmedKnown: true,
    display: target.read,
    inflight: false,
    queuedCount: 0,
    settledAt: 0,
    waiters: [],
  };
  entries.set(target.id, entry);
  return entry;
};

const adjustUnread = (entry: ReadEntry, read: boolean): void => {
  const delta = read ? -1 : 1;
  if (entry.kind === 'later') sidebar.adjustSavedUnread(delta);
  else if (entry.feedId !== null) sidebar.adjustFeedUnread(entry.feedId, delta);
};

export const setDisplay = (
  id: string,
  entry: ReadEntry,
  read: boolean
): boolean => {
  if (entry.display === read) return false;
  entry.display = read;
  patchArticle(id, { read });
  adjustUnread(entry, read);
  return true;
};

const settleCoveredEntry = (
  id: string,
  entry: ReadEntry,
  outcome: 'ok' | 'ambiguous',
  seq: number
): void => {
  entry.settledAt = seq;
  if (outcome === 'ambiguous') {
    entry.confirmedKnown = false;
    return;
  }
  entry.confirmed = true;
  entry.confirmedKnown = true;
  // Badges are left to the post-drain count refresh, which already excludes these rows.
  if (entry.queuedCount === 0 && !entry.display) {
    entry.display = true;
    patchArticle(id, { read: true });
  }
};

/**
 * Records a barrier's settlement for the rows it covers. An `ok` barrier proves the covered rows are
 * read on the server: they are confirmed read and idle rows show it. After an ambiguous outcome the
 * covered rows lose their confirmed value until a write or fresh snapshot restores it.
 */
export const applyBarrierSettlement = (
  barrier: ReadBarrier,
  outcome: 'ok' | 'ambiguous'
): void => {
  const seq = clock();
  for (const [id, entry] of entries) {
    if (barrier.affects({ id, kind: entry.kind, feedId: entry.feedId }))
      settleCoveredEntry(id, entry, outcome, seq);
  }
  if (outcome === 'ok' && activeSnapshots.size > 0) {
    barrierStamps.push({ seq, affects: barrier.affects });
  }
  retireSettledState();
};
