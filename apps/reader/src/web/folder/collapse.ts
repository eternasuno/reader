import { createSignal } from 'solid-js';

/** Where the collapsed folder ids live, per browser (folders.md Interface). */
const storageKey = 'reader.collapsedFolders';

type FolderStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** The browser's storage, absent outside a browser. */
const storage = (): FolderStorage | undefined =>
  (globalThis as { readonly localStorage?: FolderStorage }).localStorage;

/** A JSON array of ids; a missing or undecodable value is no state. */
const decode = (text: string | null | undefined): ReadonlyArray<string> => {
  if (text === null || text === undefined) return [];

  try {
    const value: unknown = JSON.parse(text);

    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
};

const read = (): ReadonlySet<string> => {
  try {
    return new Set(decode(storage()?.getItem(storageKey)));
  } catch {
    return new Set();
  }
};

const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(read());

/** A folder with no stored state is expanded (folders.md). */
export const folderCollapsed = (folderId: string): boolean =>
  collapsed().has(folderId);

const write = (next: ReadonlySet<string>): void => {
  setCollapsed(next);

  try {
    storage()?.setItem(storageKey, JSON.stringify([...next]));
  } catch {
    // The state still holds for this page when storage refuses the write.
  }
};

/** Toggles one folder; it never selects the folder or changes the scope. */
export const toggleFolderCollapsed = (folderId: string): void => {
  const next = new Set(collapsed());

  if (next.has(folderId)) next.delete(folderId);
  else next.add(folderId);

  write(next);
};

/** Expands one folder, e.g. the one a newly selected feed is in. */
export const expandFolder = (folderId: string): void => {
  if (!collapsed().has(folderId)) return;

  const next = new Set(collapsed());

  next.delete(folderId);
  write(next);
};
