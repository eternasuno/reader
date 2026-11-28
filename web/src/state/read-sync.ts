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
  ReadBarrier,
  ReadTarget,
  UnknownReadTarget,
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
  targetOf,
} from './read-sync-state';
import {
  isAmbiguousError,
  recoverReadSnapshots,
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
  UnknownReadTarget,
} from './read-sync-state';
export {
  beginRecordSnapshot,
  mergeSnapshotRead,
  targetOf,
} from './read-sync-state';

const MARK_IDS_CHUNK_SIZE = 200;

const MARK_IDS_CONCURRENCY = 2;

type MarkReadChunk = {
  kind: LibraryArticle['kind'];
  ids: ReadonlyArray<string>;
  single: boolean;
};

/** Keeps the last intent per article and skips values already confirmed. */
const popCoalescedSegment = (): Map<string, boolean> => {
  const coalesced = new Map<string, boolean>();
  for (let item = queue[0]; item?.type === 'intent'; item = queue[0]) {
    queue.shift();
    const entry = entries.get(item.id);
    if (entry !== undefined) entry.queuedCount -= 1;
    coalesced.set(item.id, item.read);
  }
  for (const [id, read] of [...coalesced]) {
    const entry = entries.get(id);
    if (entry !== undefined && entry.confirmed !== read) continue;

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

const markReadChunks = (
  kind: LibraryArticle['kind'],
  ids: ReadonlyArray<string>
): Array<MarkReadChunk> => {
  const chunks: Array<MarkReadChunk> = [];
  for (let i = 0; i < ids.length; i += MARK_IDS_CHUNK_SIZE) {
    chunks.push({
      kind,
      ids: ids.slice(i, i + MARK_IDS_CHUNK_SIZE),
      single: ids.length === 1,
    });
  }

  return chunks;
};

const runMarkReadChunks = async (
  chunks: ReadonlyArray<MarkReadChunk>,
  sentEpoch: number,
  onToast: (error: unknown) => void
): Promise<void> => {
  const pending = chunks.values();
  const workers = Array.from(
    { length: Math.min(MARK_IDS_CONCURRENCY, chunks.length) },
    async () => {
      for (const { kind, ids, single } of pending) {
        if (sentEpoch !== queueState.epoch) return;

        await runSegmentRequest(
          ids,
          true,
          () =>
            single
              ? sendSetRead(kind, ids[0], true)
              : sendMarkIdsRead(kind, ids),
          sentEpoch,
          onToast
        );
      }
    }
  );
  await Promise.allSettled(workers);
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
  const chunks = [
    ...markReadChunks('later', laterReadIds),
    ...markReadChunks('feed', feedReadIds),
  ];
  const tasks = [runMarkReadChunks(chunks, sentEpoch, onToast)];
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

const drainQueue = (): void => {
  queueState.dispatching = false;
  recoverReadSnapshots();
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

/** Applies a read intent and resolves with the confirmed value once the article is idle. */
export const requestRead = (
  target: ReadTarget,
  read: boolean
): Promise<boolean | null> => {
  const existing = entries.get(target.id);
  const currentConfirmed =
    existing === undefined ? target.read : existing.confirmed;
  const idle = existing === undefined || isEntryIdle(existing);
  const hasBarrier =
    queueState.activeBarrier !== null ||
    queue.some((item) => item.type === 'barrier');
  if (idle && currentConfirmed === read && !hasBarrier) {
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

const withCachedPrior = (target: ReadTarget | UnknownReadTarget) => {
  if (target.read !== undefined) return target;

  const article = articleById(target.id);
  return article === null ? target : targetOf(article);
};

/** Marks `targets` read, adjusting counts only for rows with a known prior state. */
export const requestReadMany = (
  targets: ReadonlyArray<ReadTarget | UnknownReadTarget>
): void => {
  let changed = false;
  for (const target of targets) {
    const current = withCachedPrior(target);
    const existing = entries.get(current.id);
    if (current.read !== undefined && (existing?.display ?? current.read))
      continue;

    const entry = ensureEntry(current);
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
