import { Option } from 'effect';
import type { Counts, Feed, Folder } from '../lib/library';

const byName = (left: Folder, right: Folder): number =>
  left.name === right.name
    ? left.id.localeCompare(right.id)
    : left.name.localeCompare(right.name);

export const upsertFolder = (
  folders: ReadonlyArray<Folder>,
  folder: Folder
): ReadonlyArray<Folder> =>
  [...folders.filter((item) => item.id !== folder.id), folder].sort(byName);

export const renameFolderIn = (
  folders: ReadonlyArray<Folder>,
  id: string,
  name: string
): ReadonlyArray<Folder> =>
  folders
    .map((folder) => (folder.id === id ? { ...folder, name } : folder))
    .sort(byName);

export const feedsInFolder = (
  feeds: ReadonlyArray<Feed>,
  folderId: string
): ReadonlyArray<Feed> =>
  feeds.filter((feed) => Option.getOrUndefined(feed.folderId) === folderId);

export const folderUnread = (
  counts: Counts,
  feeds: ReadonlyArray<Feed>,
  folderId: string
): number =>
  feedsInFolder(feeds, folderId).reduce(
    (sum, feed) => sum + (counts.feeds[feed.id] ?? 0),
    0
  );

export type FeedGroups = {
  readonly groups: ReadonlyArray<{
    readonly folder: Folder;
    readonly feeds: ReadonlyArray<Feed>;
  }>;
  readonly topLevel: ReadonlyArray<Feed>;
};

export const groupFeeds = (
  folders: ReadonlyArray<Folder>,
  feeds: ReadonlyArray<Feed>
): FeedGroups => {
  const known = new Set(folders.map((folder) => folder.id));
  const folderOf = (feed: Feed): string | undefined =>
    Option.getOrUndefined(feed.folderId);

  return {
    groups: folders.map((folder) => ({
      folder,
      feeds: feedsInFolder(feeds, folder.id),
    })),
    topLevel: feeds.filter((feed) => {
      const folderId = folderOf(feed);

      return folderId === undefined || !known.has(folderId);
    }),
  };
};
