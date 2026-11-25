/**
 * Per-entity optimistic mutation ownership trackers so overlapping mutations on the same feed never
 * let a late failure undo a newer user choice. Article read state syncs through `read-sync.ts`.
 */

import type { LibraryArticle } from './library-store';
import { onSessionCleared } from './session';

let mutationEpoch = 0;

export interface DroppedFeedRows {
  scopeGeneration: number;
  folderId: string | null;
  rows: ReadonlyArray<LibraryArticle>;
  orderIds: ReadonlyArray<string>;
}

interface FeedMoveIntent {
  token: number;
  targetFolderId: string | null;
}

interface FeedMoveEntry {
  confirmedFolderId: string | null;
  confirmedToken: number;
  pending: Array<FeedMoveIntent>;
  dropped: DroppedFeedRows | null;
}

interface FeedMoveSettleResult {
  owns: boolean;
  targetFolderId: string | null;
  dropped: DroppedFeedRows | null;
}

class FeedMoveTracker {
  private nextToken = 0;
  private minToken = 0;
  private readonly entries = new Map<string, FeedMoveEntry>();

  begin(
    feedId: string,
    currentFolderId: string | null,
    targetFolderId: string | null
  ): number {
    this.nextToken += 1;
    const token = this.nextToken;
    const existing = this.entries.get(feedId);
    if (existing === undefined) {
      this.entries.set(feedId, {
        confirmedFolderId: currentFolderId,
        confirmedToken: 0,
        pending: [{ token, targetFolderId }],
        dropped: null,
      });
    } else {
      existing.pending.push({ token, targetFolderId });
    }
    return token;
  }

  recordDrop(feedId: string, drop: DroppedFeedRows): void {
    const entry = this.entries.get(feedId);
    if (entry === undefined || drop.rows.length === 0) return;

    const current = entry.dropped;
    if (
      current === null ||
      current.scopeGeneration !== drop.scopeGeneration ||
      current.folderId !== drop.folderId
    ) {
      entry.dropped = drop;
    }
  }

  private settle(
    feedId: string,
    token: number,
    succeeded: boolean,
    folderId: string | null
  ): FeedMoveSettleResult | null {
    if (token <= this.minToken) return null;
    const entry = this.entries.get(feedId);
    if (entry === undefined) return null;

    entry.pending = entry.pending.filter((intent) => intent.token !== token);
    if (succeeded && token > entry.confirmedToken) {
      entry.confirmedFolderId = folderId;
      entry.confirmedToken = token;
    }

    const owns =
      entry.confirmedToken <= token &&
      !entry.pending.some((intent) => intent.token > token);
    const latestValid = [...entry.pending]
      .reverse()
      .find((intent) => intent.token > entry.confirmedToken);
    const targetFolderId =
      latestValid !== undefined
        ? latestValid.targetFolderId
        : entry.confirmedFolderId;
    const dropped = entry.dropped;
    if (entry.pending.length === 0) this.entries.delete(feedId);
    return { owns, targetFolderId, dropped };
  }

  succeed(
    feedId: string,
    token: number,
    folderId: string | null
  ): FeedMoveSettleResult | null {
    return this.settle(feedId, token, true, folderId);
  }

  fail(feedId: string, token: number): FeedMoveSettleResult | null {
    return this.settle(feedId, token, false, null);
  }

  reset(): void {
    this.minToken = this.nextToken;
    this.entries.clear();
  }
}

export class LatestTokenMap {
  private nextToken = 0;
  private epoch = mutationEpoch;
  private readonly tokens = new Map<string, number>();

  private syncEpoch(): void {
    if (this.epoch === mutationEpoch) return;
    this.epoch = mutationEpoch;
    this.tokens.clear();
  }

  claim(key: string): number {
    this.syncEpoch();
    this.nextToken += 1;
    this.tokens.set(key, this.nextToken);
    return this.nextToken;
  }

  isCurrent(key: string, token: number): boolean {
    this.syncEpoch();
    return this.tokens.get(key) === token;
  }

  release(key: string, token: number): void {
    this.syncEpoch();
    if (this.tokens.get(key) === token) {
      this.tokens.delete(key);
    }
  }

  reset(): void {
    this.epoch = mutationEpoch;
    this.tokens.clear();
  }
}

export const feedMoveTracker = new FeedMoveTracker();

export const clearLibraryMutationsState = (): void => {
  mutationEpoch += 1;
  feedMoveTracker.reset();
};

onSessionCleared(clearLibraryMutationsState);
