import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The per-browser collapse state of folders (folders.md Interface): the ids of
 * collapsed folders under `reader.collapsedFolders`, a missing or undecodable
 * value being no state.
 */

const storageKey = 'reader.collapsedFolders';

const fakeStorage = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));

  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    items,
  };
};

const useStorage = (stored?: string) => {
  const storage = fakeStorage(
    stored === undefined ? {} : { [storageKey]: stored }
  );

  (globalThis as { localStorage?: unknown }).localStorage = storage;

  return storage;
};

/** A fresh module, so its initial state is read from the current storage. */
const collapseModule = async () => {
  vi.resetModules();

  return import('../../../src/web/folder/collapse');
};

beforeEach(() => {
  useStorage();
});

describe('Scenario: Folders without a saved collapsed state are expanded by default', () => {
  it('treats every folder as expanded', async () => {
    const { folderCollapsed } = await collapseModule();

    expect(folderCollapsed('folder-tech')).toBe(false);
  });

  it('treats a missing or undecodable value as no state', async () => {
    for (const stored of ['not json', '{"a":1}', '[]']) {
      useStorage(stored);
      const { folderCollapsed } = await collapseModule();

      expect(folderCollapsed('folder-tech')).toBe(false);
    }
  });
});

describe('Scenario: The collapsed state is kept in this browser', () => {
  it('stores the collapsed ids as a JSON array and reads them back', async () => {
    const storage = useStorage();
    const { folderCollapsed, toggleFolderCollapsed } = await collapseModule();

    toggleFolderCollapsed('folder-tech');

    expect(folderCollapsed('folder-tech')).toBe(true);
    expect(storage.items.get(storageKey)).toBe('["folder-tech"]');

    const reopened = await collapseModule();

    expect(reopened.folderCollapsed('folder-tech')).toBe(true);
    expect(reopened.folderCollapsed('folder-news')).toBe(false);
  });

  it('ignores entries that are not ids', async () => {
    useStorage('["folder-tech",1,null]');
    const { folderCollapsed } = await collapseModule();

    expect(folderCollapsed('folder-tech')).toBe(true);
  });
});

describe('Scenario: Clicking the arrow expands the folder', () => {
  it('toggles one folder back to expanded', async () => {
    const { folderCollapsed, toggleFolderCollapsed } = await collapseModule();

    toggleFolderCollapsed('folder-tech');
    toggleFolderCollapsed('folder-tech');

    expect(folderCollapsed('folder-tech')).toBe(false);
  });

  it('expands one folder without touching the others', async () => {
    useStorage('["folder-tech","folder-news"]');
    const { expandFolder, folderCollapsed } = await collapseModule();

    expandFolder('folder-tech');

    expect(folderCollapsed('folder-tech')).toBe(false);
    expect(folderCollapsed('folder-news')).toBe(true);
  });
});
