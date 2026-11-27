import type { LibraryScope } from './scope';

const BATCH_SIZE = 30;

export interface QueueEntry {
  id: string;
  feedId?: string;
  groupStart: boolean;
}

const positions = new Map<string, { entry: QueueEntry; index: number }>();
const folderMembership = new Map<string, string | null>();
const removedIds = new Set<string>();
const queued = new Map<string, QueueEntry>();

export const resetQueue = (): void => {
  positions.clear();
  folderMembership.clear();
  removedIds.clear();
  queued.clear();
};

export const acceptQueue = (entries: ReadonlyArray<QueueEntry>): void => {
  for (const entry of entries) {
    if (removedIds.has(entry.id) || positions.has(entry.id)) continue;
    positions.set(entry.id, { entry, index: positions.size });
    queued.set(entry.id, entry);
  }
};

export const snapshotPosition = (id: string) => positions.get(id);

export const setFolderMembership = (
  feedId: string,
  folderId: string | null
): string | null | undefined => {
  const previous = folderMembership.get(feedId);
  folderMembership.set(feedId, folderId);
  return previous;
};

export const consumeQueuedId = (id: string): void => {
  queued.delete(id);
};

export const removeQueuedId = (id: string): void => {
  removedIds.add(id);
  consumeQueuedId(id);
};

export const isQueued = (scope: LibraryScope, entry: QueueEntry): boolean =>
  queued.has(entry.id) &&
  (scope.kind !== 'folder' ||
    entry.feedId === undefined ||
    !folderMembership.has(entry.feedId) ||
    folderMembership.get(entry.feedId) === scope.folderId);

export const hasQueuedFeed = (feedId: string): boolean => {
  for (const entry of queued.values()) {
    if (entry.feedId === feedId) return true;
  }

  return false;
};

export const nextChunk = (scope: LibraryScope): Array<QueueEntry> => {
  const chunk: Array<QueueEntry> = [];
  for (const entry of queued.values()) {
    if (isQueued(scope, entry)) chunk.push(entry);
    if (chunk.length === BATCH_SIZE) break;
  }

  return chunk;
};
