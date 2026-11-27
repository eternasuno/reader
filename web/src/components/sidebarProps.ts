import type { Feed, Folder } from '../api';
import type { LibraryScope } from '../state';

export interface SidebarProps {
  scope: LibraryScope;
  unreadOnly: boolean;
  onNavigate: (url: string) => void;
  onRequestAddFeed: () => void;
  onRequestNewFolder: (feed: Feed) => void;
  onRequestRenameFolder: (folder: Folder) => void;
  onMoveFeed: (feed: Feed, folderId: string | null) => Promise<void>;
  onRequestImportOpml: () => void;
  /** `SP-ADD-1`: opens the add-link dialog from the read-later row menu. */
  onRequestAddLink: () => void;
}
