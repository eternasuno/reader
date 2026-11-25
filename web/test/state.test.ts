import { describe, expect, it } from 'vitest';
import * as state from '../src/state';

describe('scope comparison', () => {
  it('compares scopes by kind and id', () => {
    expect(state.isSameScope({ kind: 'later' }, { kind: 'later' })).toBe(true);
    expect(state.isSameScope({ kind: 'later' }, { kind: 'all' })).toBe(false);
    expect(
      state.isSameScope(
        { kind: 'feed', feedId: 'a' },
        { kind: 'feed', feedId: 'a' }
      )
    ).toBe(true);
    expect(
      state.isSameScope(
        { kind: 'feed', feedId: 'a' },
        { kind: 'feed', feedId: 'b' }
      )
    ).toBe(false);
    expect(
      state.isSameScope(
        { kind: 'folder', folderId: 'a' },
        { kind: 'folder', folderId: 'b' }
      )
    ).toBe(false);
    expect(
      state.isSameScope(
        { kind: 'feed', feedId: 'a' },
        { kind: 'folder', folderId: 'a' }
      )
    ).toBe(false);
  });
});

describe('library URLs', () => {
  it('builds library URLs with an optional article and ?unread flag', () => {
    expect(state.buildLibraryUrl({ kind: 'later' })).toBe('/later');
    expect(state.buildLibraryUrl({ kind: 'folder', folderId: 'x' })).toBe(
      '/folder/x'
    );
    expect(state.buildLibraryUrl({ kind: 'later' }, { articleId: 'p1' })).toBe(
      '/later/p1'
    );
    expect(state.buildLibraryUrl({ kind: 'all' }, { unreadOnly: true })).toBe(
      '/all?unread'
    );
    expect(
      state.buildLibraryUrl(
        { kind: 'all' },
        { articleId: 'i1', unreadOnly: true }
      )
    ).toBe('/all/i1?unread');
    expect(
      state.buildLibraryUrl(
        { kind: 'feed', feedId: 'f 1' },
        { articleId: 'i2' }
      )
    ).toBe('/feed/f%201/i2');
    expect(
      state.buildLibraryUrl({ kind: 'later' }, { unreadOnly: false })
    ).toBe('/later');
    expect(state.buildLibraryUrl({ kind: 'later' }, { articleId: '' })).toBe(
      '/later'
    );
  });
});
