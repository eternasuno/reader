import type { Scope } from './scope';

/**
 * What the path says (LIB-URL-1, LIB-URL-2), kept free of the router so it can
 * be read anywhere: the scope a path names, its open article and the filter.
 */

export type LibraryParams = {
  readonly pageId?: string | undefined;
  readonly itemId?: string | undefined;
  readonly feedId?: string | undefined;
  readonly folderId?: string | undefined;
};

/** The scope a path names; an unknown section is the later list (LIB-URL-2). */
export const scopeFromPath = (pathname: string): Scope => {
  const [section, id] = pathname.split('/').filter((part) => part !== '');

  if (section === 'all') return { kind: 'all' };
  if (section === 'feed' && id !== undefined) return { kind: 'feed', id };
  if (section === 'folder' && id !== undefined) return { kind: 'folder', id };

  return { kind: 'later' };
};

/** The unread filter is the presence-only `?unread` (reader-spec Routes). */
export const hasUnread = (search: string): boolean =>
  new URLSearchParams(search).has('unread');

/** The open article's id, from whichever article parameter the path carries. */
export const articleIdOf = (params: LibraryParams): string | undefined =>
  params.pageId ?? params.itemId;
