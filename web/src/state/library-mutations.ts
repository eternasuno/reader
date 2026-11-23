/**
 * Per-entity optimistic mutation ownership trackers so overlapping mutations on the same article
 * or feed never let a late failure undo a newer user choice.
 */

import type { LibraryArticle, LibraryArticlePatch } from './library-store';
import { onSessionCleared } from './session';

let mutationEpoch = 0;

interface ReadIntent {
  token: number;
  target: boolean;
}

interface ReadMutationEntry {
  confirmed: boolean;
  confirmedToken: number;
  pending: Array<ReadIntent>;
}

interface ReadSettleResult {
  owns: boolean;
  targetRead: boolean;
  settledAll: boolean;
}

class ReadMutationTracker {
  private nextToken = 0;
  private minToken = 0;
  private readonly entries = new Map<string, ReadMutationEntry>();

  hasPending(articleId: string): boolean {
    const entry = this.entries.get(articleId);
    if (entry === undefined) return false;
    return entry.pending.some((intent) => intent.token > entry.confirmedToken);
  }

  begin(articleId: string, currentRead: boolean, targetRead: boolean): number {
    this.nextToken += 1;
    const token = this.nextToken;
    const existing = this.entries.get(articleId);
    if (existing === undefined) {
      this.entries.set(articleId, {
        confirmed: currentRead,
        confirmedToken: 0,
        pending: [{ token, target: targetRead }],
      });
    } else {
      existing.pending.push({ token, target: targetRead });
    }
    return token;
  }

  private settle(
    articleId: string,
    token: number,
    confirmedValue?: boolean
  ): ReadSettleResult | null {
    if (token <= this.minToken) return null;
    const entry = this.entries.get(articleId);
    if (entry === undefined) return null;

    entry.pending = entry.pending.filter((intent) => intent.token !== token);
    if (confirmedValue !== undefined && token > entry.confirmedToken) {
      entry.confirmed = confirmedValue;
      entry.confirmedToken = token;
    }

    const owns =
      entry.confirmedToken <= token &&
      !entry.pending.some((intent) => intent.token > token);
    const latestValid = [...entry.pending]
      .reverse()
      .find((intent) => intent.token > entry.confirmedToken);
    const targetRead =
      latestValid !== undefined ? latestValid.target : entry.confirmed;
    const settledAll = entry.pending.length === 0;
    if (settledAll) this.entries.delete(articleId);
    return { owns, targetRead, settledAll };
  }

  succeed(
    articleId: string,
    token: number,
    nextRead: boolean
  ): ReadSettleResult | null {
    return this.settle(articleId, token, nextRead);
  }

  fail(articleId: string, token: number): ReadSettleResult | null {
    return this.settle(articleId, token);
  }

  reset(): void {
    this.minToken = this.nextToken;
    this.entries.clear();
  }
}

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

export const readTracker = new ReadMutationTracker();
export const feedMoveTracker = new FeedMoveTracker();

class ArticleSnapshotGuard {
  private version = 0;
  private readonly fields = new Map<
    string,
    Partial<Record<keyof LibraryArticlePatch, number>>
  >();

  capture(): number {
    return this.version;
  }

  record(articleId: string, patch: LibraryArticlePatch): void {
    this.version += 1;
    const entry = this.fields.get(articleId) ?? {};
    if (patch.read !== undefined) entry.read = this.version;
    if (patch.extractedContent !== undefined) {
      entry.extractedContent = this.version;
    }
    this.fields.set(articleId, entry);
  }

  evict(articleId: string): void {
    this.fields.delete(articleId);
  }

  merge(
    incoming: LibraryArticle,
    existing: LibraryArticle | undefined,
    dispatchVersion: number | undefined
  ): LibraryArticle {
    if (existing === undefined || dispatchVersion === undefined) {
      return incoming;
    }

    const entry = this.fields.get(incoming.id);
    const keepRead =
      (entry?.read !== undefined && entry.read > dispatchVersion) ||
      readTracker.hasPending(incoming.id);
    const keepExtracted =
      entry?.extractedContent !== undefined &&
      entry.extractedContent > dispatchVersion;
    if (!keepRead && !keepExtracted) return incoming;

    const merged = { ...incoming };
    if (keepRead) merged.read = existing.read;
    if (keepExtracted && merged.kind === 'feed' && existing.kind === 'feed') {
      merged.extractedContent = existing.extractedContent;
    }
    return merged as LibraryArticle;
  }

  reset(): void {
    this.fields.clear();
  }
}

export const articleSnapshotGuard = new ArticleSnapshotGuard();

export const clearLibraryMutationsState = (): void => {
  mutationEpoch += 1;
  readTracker.reset();
  feedMoveTracker.reset();
  articleSnapshotGuard.reset();
};

onSessionCleared(clearLibraryMutationsState);
