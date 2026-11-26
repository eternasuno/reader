/**
 * Settlement of read write results for `read-sync.ts`: a success confirms the rows it covered; a
 * failure rolls rows back unless a later intent superseded it, and ambiguous or unknown-baseline
 * failures schedule a detail re-fetch after the queue drains.
 */

import { flush } from 'solid-js';
import type { ReadEntry } from './read-sync-state';
import {
  ambiguousIds,
  clock,
  entries,
  resolveWaiters,
  setDisplay,
} from './read-sync-state';
import { isAmbiguousError } from './read-sync-transport';

export const settleSuccess = (
  ids: ReadonlyArray<string>,
  sentRead: boolean
): void => {
  for (const id of ids) {
    const entry = entries.get(id);
    if (entry === undefined) continue;
    entry.inflight = false;
    entry.confirmed = sentRead;
    entry.confirmedKnown = true;
    entry.settledAt = clock();
    resolveWaiters(id, entry);
  }
};

/**
 * Settles a failed write. A failure superseded by a later queued intent changes nothing. Otherwise
 * the row rolls back to its confirmed value, or, when that value is unknown, is re-fetched after the
 * queue drains. An ambiguous failure leaves the server value unknown until that re-fetch. Returns whether the user's change was lost, so the caller shows one toast.
 */
const settleFailedEntry = (
  id: string,
  entry: ReadEntry,
  ambiguous: boolean
): boolean => {
  entry.inflight = false;
  entry.settledAt = clock();
  if (ambiguous) ambiguousIds.add(id);
  let lost = false;
  if (entry.queuedCount === 0) {
    if (entry.confirmedKnown) {
      lost = setDisplay(id, entry, entry.confirmed);
    } else {
      ambiguousIds.add(id);
      lost = true;
    }
  }
  // The write may have committed, so a queued intent must be sent even if it equals the old value.
  if (ambiguous) entry.confirmedKnown = false;
  resolveWaiters(id, entry);
  return lost;
};

export const settleFailure = (
  ids: ReadonlyArray<string>,
  error: unknown
): boolean => {
  const ambiguous = isAmbiguousError(error);
  let lostAny = false;
  for (const id of ids) {
    const entry = entries.get(id);
    if (entry !== undefined && settleFailedEntry(id, entry, ambiguous)) {
      lostAny = true;
    }
  }
  if (lostAny) flush();
  return lostAny;
};
