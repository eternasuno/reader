import { describe, expect, it } from 'vitest';
import {
  readCollapsedFolders,
  writeCollapsedFolders,
} from '../../../src/models/library/folder-collapse';

const fakeStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));

  return {
    values,
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
  };
};

describe('collapsed folders storage', () => {
  it('round trips the collapsed folder ids', () => {
    const storage = fakeStorage();
    writeCollapsedFolders(new Set(['a', 'b']), storage);

    expect(storage.values.get('reader.collapsedFolders')).toBe('["a","b"]');
    expect([...readCollapsedFolders(storage)]).toEqual(['a', 'b']);
  });

  it('reads missing and garbage values as empty', () => {
    const missing = fakeStorage();
    const garbage = fakeStorage({
      'reader.collapsedFolders': 'not json',
    });
    const wrongShape = fakeStorage({
      'reader.collapsedFolders': '{"a":1}',
    });

    expect(readCollapsedFolders(missing).size).toBe(0);
    expect(readCollapsedFolders(garbage).size).toBe(0);
    expect(readCollapsedFolders(wrongShape).size).toBe(0);
  });
});
