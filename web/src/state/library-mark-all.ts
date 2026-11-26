/**
 * Shared mark-all pending state, scope matching, and detail snapshot refresh helpers.
 */

import { createSignal, flush } from 'solid-js';
import type { LibraryArticle } from './library-store';
import { beginRecordSnapshot } from './read-sync';
import { fetchArticle } from './read-sync-transport';
import type { LibraryScope } from './scope';
import { scopeBasePath } from './scope';
import { onSessionCleared } from './session';
import * as sidebar from './sidebar';

const [pendingByScope, setPendingByScope] = createSignal<
  Readonly<Record<string, number>>
>({});
let pendingEpoch = 0;

/** Returns whether `scope` currently has at least one pending or executing mark-all barrier. */
export const isMarkingScope = (scope: LibraryScope): boolean =>
  (pendingByScope()[scopeBasePath(scope)] ?? 0) > 0;

/** Tracks one pending mark-all barrier for `scope`, returning an idempotent settle callback. */
export const beginScopeMark = (scope: LibraryScope): (() => void) => {
  const key = scopeBasePath(scope);
  const startEpoch = pendingEpoch;
  let settled = false;

  setPendingByScope((prev) => ({
    ...prev,
    [key]: (prev[key] ?? 0) + 1,
  }));
  flush();

  return () => {
    if (settled || pendingEpoch !== startEpoch) return;
    settled = true;

    setPendingByScope((prev) => {
      const nextCount = (prev[key] ?? 0) - 1;
      if (nextCount > 0) return { ...prev, [key]: nextCount };

      const { [key]: _, ...rest } = prev;
      return rest;
    });
    flush();
  };
};

export type ScopeMatcher = (row: {
  kind: LibraryArticle['kind'];
  feedId: string | null;
}) => boolean;

/** Freezes `scope` membership as of now; folder membership is read from the current sidebar. */
export const scopeMatcher = (scope: LibraryScope): ScopeMatcher => {
  switch (scope.kind) {
    case 'later':
      return (row) => row.kind === 'later';
    case 'all':
      return (row) => row.kind === 'feed';
    case 'feed':
      return (row) => row.kind === 'feed' && row.feedId === scope.feedId;
    case 'folder': {
      const feedIds = new Set(
        sidebar.folderFeeds(scope.folderId).map((feed) => feed.id)
      );
      return (row) =>
        row.kind === 'feed' && row.feedId !== null && feedIds.has(row.feedId);
    }
  }
};

/** Re-fetches one article detail inside a snapshot token and passes the decoded record to `commit`. */
export const refreshArticleSnapshot = async (
  kind: LibraryArticle['kind'],
  articleId: string,
  commit: (loaded: LibraryArticle | null, snapshotSeq: number) => void
): Promise<void> => {
  const snapshot = beginRecordSnapshot();
  try {
    commit(await fetchArticle(kind, articleId), snapshot.seq);
  } catch {
    // Best-effort refresh after mark-all; list reload keeps state consistent.
  } finally {
    snapshot.release();
  }
};

onSessionCleared(() => {
  pendingEpoch += 1;
  setPendingByScope({});
  flush();
});
