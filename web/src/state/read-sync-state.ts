/**
 * Shared entry registry, snapshot sequence stamps, and store display patching for `read-sync.ts`.
 */

import type { LibraryArticle } from './library-store';
import { articleById, patchArticle, trimRecordCache } from './library-store';
import * as sidebar from './sidebar';

export type ReadTarget = BarrierTarget & { read: boolean };

export type UnknownReadTarget = BarrierTarget & { read?: never };

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
  /** Last server-confirmed value, or undefined if unknown or invalidated by an ambiguous write. */
  confirmed: boolean | undefined;
  /** Latest queued intent, else the last display value. */
  display: boolean;
  /** Unknown-prior intents leave count reconciliation to the post-drain refresh. */
  adjustsUnread: boolean;
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

const pinsRecord = (entry: ReadEntry): boolean =>
  !isEntryIdle(entry) ||
  entry.confirmed !== undefined ||
  hasOlderActiveSnapshot(entry.settledAt);

export const hasActiveEntry = (id: string): boolean => {
  const entry = entries.get(id);
  return entry !== undefined && pinsRecord(entry);
};

export const dropIdleUnknownEntry = (id: string): void => {
  const entry = entries.get(id);
  if (
    entry !== undefined &&
    entry.confirmed === undefined &&
    isEntryIdle(entry)
  )
    entries.delete(id);
};

const isRetirable = (entry: ReadEntry): boolean =>
  isEntryIdle(entry) &&
  entry.confirmed !== undefined &&
  !hasOlderActiveSnapshot(entry.settledAt);

const retireBarrierStamps = (): void => {
  for (let i = barrierStamps.length - 1; i >= 0; i -= 1) {
    if (!hasOlderActiveSnapshot(barrierStamps[i].seq))
      barrierStamps.splice(i, 1);
  }
};

/** Retires settled state and reports whether a record lost its read pin. */
const retireSettledState = (releasedSeq?: number): boolean => {
  let lostPin = false;
  for (const [id, entry] of entries) {
    if (isRetirable(entry)) {
      entries.delete(id);
      lostPin = true;
    } else if (articleById(id) === null) {
      dropIdleUnknownEntry(id);
    } else if (releasedSeq !== undefined && releasedSeq < entry.settledAt) {
      lostPin ||= !pinsRecord(entry);
    }
  }

  retireBarrierStamps();

  return lostPin;
};

export const resolveWaiters = (id: string, entry: ReadEntry): void => {
  if (!isEntryIdle(entry)) return;

  const value = entry.confirmed ?? null;
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
      if (!activeSnapshots.delete(tokenSeq)) return;

      if (retireSettledState(tokenSeq)) trimRecordCache();
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
  snapshotSeq: number
): boolean => {
  const entry = entries.get(incoming.id);
  if (entry === undefined) {
    return isBehindBarrier(targetOf(incoming), snapshotSeq) || incoming.read;
  }

  if (!entry.inflight && snapshotSeq >= entry.settledAt) {
    entry.confirmed = incoming.read;
    if (entry.queuedCount === 0) entry.display = incoming.read;
  }

  return entry.display;
};

export const ensureEntry = (
  target: ReadTarget | UnknownReadTarget
): ReadEntry => {
  const existing = entries.get(target.id);
  if (existing !== undefined) return existing;

  const entry: ReadEntry = {
    kind: target.kind,
    feedId: target.feedId,
    confirmed: target.read,
    display: target.read ?? true,
    adjustsUnread: target.read !== undefined,
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
  if (entry.adjustsUnread || articleById(id) !== null)
    patchArticle(id, { read });
  if (entry.adjustsUnread) adjustUnread(entry, read);

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
    entry.confirmed = undefined;
    return;
  }

  entry.confirmed = true;
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
