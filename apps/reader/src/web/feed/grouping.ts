import { type Folder, folders } from '../folder';
import { type Feed, feeds } from './list';

/** One folder with the feeds that are in it right now. */
export type FeedGroup = {
  readonly folder: Folder;
  readonly feeds: ReadonlyArray<Feed>;
};

export type FeedGroups = {
  readonly groups: ReadonlyArray<FeedGroup>;
  readonly topLevel: ReadonlyArray<Feed>;
};

/** Whether a feed names a folder the sidebar knows; a stale one is top level. */
const inKnownFolder = (feed: Feed, known: ReadonlySet<string>): boolean =>
  feed.folderId !== undefined && known.has(feed.folderId);

/**
 * The `订阅源` section's grouping: folders first and under each its feeds, then
 * the feeds that belong to no folder, each in the order the server returned
 * (folders.md Interface; FD-FOLDER-8, FD-LIST-3). Never sorted here.
 */
export const feedGroups = (): FeedGroups => {
  const folderList = folders();
  const feedList = feeds();
  const known = new Set(folderList.map((folder) => folder.id));
  const feedsIn = (folderId: string): ReadonlyArray<Feed> =>
    feedList.filter((feed) => feed.folderId === folderId);

  return {
    groups: folderList.map((folder) => ({
      folder,
      feeds: feedsIn(folder.id),
    })),
    topLevel: feedList.filter((feed) => !inKnownFolder(feed, known)),
  };
};
