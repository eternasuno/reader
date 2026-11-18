import { Option, type Ref } from 'effect';
import type { OwnerId } from '../../../../src/entity/common/owner-id';
import type { Feed } from '../../../../src/entity/feed/feed';
import type { FeedItem } from '../../../../src/entity/feed-item/feed-item';
import type { Folder, FolderId } from '../../../../src/entity/folder/folder';
import { compareText } from '../text';

/**
 * The three feed-side ports share one state: removing a feed removes its
 * items, removing a folder removes its feeds and their items, and a feed's
 * folder must exist, so the three doubles cannot own separate stores.
 */
export type MemoryFeedState = {
  readonly folders: ReadonlyArray<Folder>;
  readonly feeds: ReadonlyArray<Feed>;
  readonly items: ReadonlyArray<FeedItem>;
};

export type FeedStateRef = Ref.Ref<MemoryFeedState>;

export const emptyFeedState: MemoryFeedState = {
  folders: [],
  feeds: [],
  items: [],
};

export const byTitleThenId = (left: Feed, right: Feed): number =>
  compareText(left.title, right.title) || compareText(left.id, right.id);

export const byNameThenId = (left: Folder, right: Folder): number =>
  compareText(left.name, right.name) || compareText(left.id, right.id);

const hasFolder = (
  folders: ReadonlyArray<Folder>,
  owner: OwnerId,
  id: FolderId
): boolean =>
  folders.some((folder) => folder.ownerId === owner && folder.id === id);

/** A folder id that names no folder of the owner, `none` naming the top level (FD-FOLDER-6). */
export const isFolderMissing = (
  folders: ReadonlyArray<Folder>,
  owner: OwnerId,
  folderId: Option.Option<FolderId>
): boolean => Option.exists(folderId, (id) => !hasFolder(folders, owner, id));

/** The feeds in the given folders of the owner, resolved at call time (FD-READ-5). */
export const folderFeedIds = (
  folders: ReadonlyArray<Folder>,
  feeds: ReadonlyArray<Feed>,
  owner: OwnerId,
  folderIds: ReadonlyArray<FolderId>
): Set<string> => {
  const wanted = new Set<string>(folderIds);
  const wantedFolders = new Set<string>(
    folders
      .filter((folder) => folder.ownerId === owner && wanted.has(folder.id))
      .map((folder) => folder.id)
  );

  return new Set<string>(
    feeds
      .filter(
        (feed) =>
          feed.ownerId === owner &&
          Option.exists(feed.folderId, (id) => wantedFolders.has(id))
      )
      .map((feed) => feed.id)
  );
};
