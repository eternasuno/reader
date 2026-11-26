/**
 * Serial ordered read-state mutation queue (`LIB-READ-1`, `LIB-READ-2`). One module-level queue
 * processes segments of coalesced per-article read intents separated by opaque barriers (mark-all).
 * Solid optimistic APIs are not used (see `upstream-issues.md`).
 */

import { flush } from 'solid-js';
import { showToast } from '../ui';
import { errorText } from './errorText';
import type { LibraryArticle } from './library-store';
import { articleById } from './library-store';
import { settleFailure, settleSuccess } from './read-sync-settle';
import type {
  BarrierItem,
  BarrierOutcome,
  EnqueueBarrierResult,
  IntentItem,
  ReadBarrier,
  ReadTarget,
} from './read-sync-state';
import {
  activeSnapshots,
  ambiguousIds,
  applyBarrierSettlement,
  barrierStamps,
  drainListeners,
  ensureEntry,
  entries,
  isEntryIdle,
  queue,
  queueState,
  resolveWaiters,
  setDisplay,
} from './read-sync-state';
import {
  isAmbiguousError,
  refetchArticleSnapshot,
  sendMarkIdsRead,
  sendSetRead,
} from './read-sync-transport';
import { onSessionCleared } from './session';

export type {
  BarrierOutcome,
  BarrierTarget,
  EnqueueBarrierResult,
  ReadBarrier,
  ReadTarget,
  RecordSnapshotToken,
} from './read-sync-state';
export {
  beginRecordSnapshot,
  mergeSnapshotRead,
  targetOf,
} from './read-sync-state';

const MARK_IDS_CHUNK_SIZE = 200;

/**
 * Pops the leading intent segment and keeps the last intent per article. An intent is dropped only
 * when its article's confirmed value is known and already equal to it.
 */
const popCoalescedSegment = (): Map<string, boolean> => {
  const coalesced = new Map<string, boolean>();
  while (queue[0]?.type === 'intent') {
    const item = queue.shift() as IntentItem;
    const entry = entries.get(item.id);
    if (entry !== undefined) entry.queuedCount -= 1;
    coalesced.set(item.id, item.read);
  }
  for (const [id, read] of [...coalesced]) {
    const entry = entries.get(id);
    if (
      entry !== undefined &&
      !(entry.confirmedKnown && entry.confirmed === read)
    )
      continue;
    coalesced.delete(id);
    if (entry !== undefined) resolveWaiters(id, entry);
  }
  return coalesced;
};

const runSegmentRequest = async (
  ids: ReadonlyArray<string>,
  sentRead: boolean,
  send: () => Promise<void>,
  sentEpoch: number,
  onToast: (error: unknown) => void
): Promise<void> => {
  try {
    await send();
    if (sentEpoch !== queueState.epoch) return;
    settleSuccess(ids, sentRead);
  } catch (error) {
    if (sentEpoch !== queueState.epoch) return;
    if (settleFailure(ids, error)) onToast(error);
  }
};

const queueMarkRead = (
  kind: LibraryArticle['kind'],
  ids: ReadonlyArray<string>,
  sentEpoch: number,
  onToast: (error: unknown) => void,
  tasks: Array<Promise<void>>
): void => {
  const sendChunk =
    ids.length === 1
      ? (chunk: ReadonlyArray<string>) => sendSetRead(kind, chunk[0], true)
      : (chunk: ReadonlyArray<string>) => sendMarkIdsRead(kind, chunk);
  for (let i = 0; i < ids.length; i += MARK_IDS_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + MARK_IDS_CHUNK_SIZE);
    tasks.push(
      runSegmentRequest(chunk, true, () => sendChunk(chunk), sentEpoch, onToast)
    );
  }
};

const executeIntentSegment = async (sentEpoch: number): Promise<void> => {
  const pending = popCoalescedSegment();
  if (pending.size === 0) return;

  const laterReadIds: Array<string> = [];
  const feedReadIds: Array<string> = [];
  const unreadTargets: Array<{ id: string; kind: LibraryArticle['kind'] }> = [];
  for (const [id, read] of pending) {
    const entry = entries.get(id);
    if (entry === undefined) continue;
    entry.inflight = true;
    if (!read) unreadTargets.push({ id, kind: entry.kind });
    else if (entry.kind === 'later') laterReadIds.push(id);
    else feedReadIds.push(id);
  }

  let toasted = false;
  const onToast = (error: unknown): void => {
    if (toasted) return;
    toasted = true;
    showToast(errorText(error), 'error');
  };
  const tasks: Array<Promise<void>> = [];
  queueMarkRead('later', laterReadIds, sentEpoch, onToast, tasks);
  queueMarkRead('feed', feedReadIds, sentEpoch, onToast, tasks);
  for (const item of unreadTargets) {
    tasks.push(
      runSegmentRequest(
        [item.id],
        false,
        () => sendSetRead(item.kind, item.id, false),
        sentEpoch,
        onToast
      )
    );
  }
  await Promise.allSettled(tasks);
};

const executeBarrierStep = async (
  item: BarrierItem,
  sentEpoch: number
): Promise<void> => {
  queueState.activeBarrier = item;
  let outcome: BarrierOutcome;
  try {
    outcome = await item.barrier.execute();
  } catch (error) {
    outcome = isAmbiguousError(error) ? 'ambiguous' : 'failed';
  }
  if (sentEpoch !== queueState.epoch) return;

  queueState.activeBarrier = null;
  if (outcome !== 'failed') applyBarrierSettlement(item.barrier, outcome);
  item.resolve(outcome);
};

/**
 * Re-fetches articles whose server value an ambiguous failure left unknown. Nothing re-fetches an
 * article outside the store, so its idle unknown entry is dropped instead.
 */
const recoverAmbiguous = (): void => {
  const ids = [...ambiguousIds];
  ambiguousIds.clear();
  for (const id of ids) {
    const article = articleById(id);
    const entry = entries.get(id);
    if (article !== null)
      void refetchArticleSnapshot(article, queueState.epoch);
    else if (entry !== undefined && isEntryIdle(entry)) entries.delete(id);
  }
};

const drainQueue = (): void => {
  queueState.dispatching = false;
  recoverAmbiguous();
  for (const cb of [...drainListeners]) {
    try {
      cb();
    } catch {
      // Listener errors must not block subsequent drain callbacks.
    }
  }
};

const runDispatcher = async (): Promise<void> => {
  const runEpoch = queueState.epoch;
  while (queue.length > 0 && runEpoch === queueState.epoch) {
    const head = queue[0];
    if (head.type === 'barrier') {
      queue.shift();
      await executeBarrierStep(head, runEpoch);
    } else {
      await executeIntentSegment(runEpoch);
    }
  }
  if (runEpoch === queueState.epoch) drainQueue();
};

const kickDispatcher = (): void => {
  if (queueState.dispatching || queue.length === 0) return;
  queueState.dispatching = true;
  void runDispatcher();
};

/**
 * Applies one read intent: shows it immediately, adjusts unread counts, and enqueues it. Resolves
 * with the confirmed value once the article has no queued or in-flight intent (`null` on clear or
 * when the confirmed value is unknown).
 */
export const requestRead = (
  target: ReadTarget,
  read: boolean
): Promise<boolean | null> => {
  const existing = entries.get(target.id);
  const currentConfirmed = existing?.confirmed ?? target.read;
  const settledKnown =
    existing === undefined ||
    (isEntryIdle(existing) && existing.confirmedKnown);
  const hasBarrier =
    queueState.activeBarrier !== null ||
    queue.some((item) => item.type === 'barrier');
  if (settledKnown && currentConfirmed === read && !hasBarrier) {
    return Promise.resolve(currentConfirmed);
  }
  const entry = ensureEntry(target);
  const settled = new Promise<boolean | null>((resolve) =>
    entry.waiters.push(resolve)
  );
  setDisplay(target.id, entry, read);
  entry.queuedCount += 1;
  queueState.mutationEpoch += 1;
  queue.push({ type: 'intent', id: target.id, read });
  flush();
  kickDispatcher();
  return settled;
};

/** Marks `targets` read, adjusting counts only for rows whose display actually changes. */
export const requestReadMany = (targets: ReadonlyArray<ReadTarget>): void => {
  let changed = false;
  for (const target of targets) {
    const existing = entries.get(target.id);
    if ((existing === undefined && target.read) || existing?.display) continue;
    const entry = ensureEntry(target);
    if (setDisplay(target.id, entry, true)) changed = true;
    entry.queuedCount += 1;
    queueState.mutationEpoch += 1;
    queue.push({ type: 'intent', id: target.id, read: true });
  }
  if (changed) flush();
  kickDispatcher();
};

/** Enqueues an opaque barrier (mark-all) that serializes with surrounding read intents. */
export const enqueueBarrier = (
  barrier: ReadBarrier
): Promise<EnqueueBarrierResult> => {
  queueState.mutationEpoch += 1;
  return new Promise<EnqueueBarrierResult>((resolve) => {
    queue.push({ type: 'barrier', barrier, resolve });
    kickDispatcher();
  });
};

export const queueIdle = (): boolean =>
  !queueState.dispatching && queue.length === 0;

export const queueEpoch = (): number => queueState.mutationEpoch;

export const onQueueDrained = (cb: () => void): (() => void) => {
  drainListeners.add(cb);
  return () => drainListeners.delete(cb);
};

export const clearReadSyncState = (): void => {
  queueState.epoch += 1;
  queueState.dispatching = false;
  activeSnapshots.clear();
  barrierStamps.length = 0;
  ambiguousIds.clear();
  const runningBarrier = queueState.activeBarrier;
  queueState.activeBarrier = null;
  runningBarrier?.resolve('cleared');
  for (const item of queue.splice(0)) {
    if (item.type === 'barrier') item.resolve('cleared');
  }
  const clearedEntries = [...entries.values()];
  entries.clear();
  for (const entry of clearedEntries) {
    for (const resolve of entry.waiters) resolve(null);
  }
};

onSessionCleared(clearReadSyncState);
