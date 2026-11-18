import { describe, expect, it } from 'vitest';
import {
  articleIdOf,
  hasUnread,
  scopeFromPath,
} from '../../../src/web/library/route-path';

/** The route is what the URL says: the scope, the open article, the filter. */

describe('the scope of a path', () => {
  it('LIB-URL-2 reads the scope from the path, an unknown id included', () => {
    expect(scopeFromPath('/later')).toEqual({ kind: 'later' });
    expect(scopeFromPath('/later/page-1')).toEqual({ kind: 'later' });
    expect(scopeFromPath('/all')).toEqual({ kind: 'all' });
    expect(scopeFromPath('/all/item-1')).toEqual({ kind: 'all' });
    expect(scopeFromPath('/feed/feed-1')).toEqual({
      kind: 'feed',
      id: 'feed-1',
    });
    expect(scopeFromPath('/feed/unknown/item-1')).toEqual({
      kind: 'feed',
      id: 'unknown',
    });
    expect(scopeFromPath('/folder/folder-1')).toEqual({
      kind: 'folder',
      id: 'folder-1',
    });
    expect(scopeFromPath('/folder/folder-1/item-1')).toEqual({
      kind: 'folder',
      id: 'folder-1',
    });
  });
});

describe('the open article of a path', () => {
  it('LIB-URL-1 takes the id from the article parameter of its scope', () => {
    expect(articleIdOf({ pageId: 'page-1' })).toBe('page-1');
    expect(articleIdOf({ itemId: 'item-1' })).toBe('item-1');
    expect(articleIdOf({ feedId: 'feed-1' })).toBeUndefined();
  });
});

describe('the unread filter', () => {
  it('LIB-FILTER-1 is the presence of the parameter, with any value', () => {
    expect(hasUnread('?unread')).toBe(true);
    expect(hasUnread('?unread=1')).toBe(true);
    expect(hasUnread('?unread=false')).toBe(true);
  });

  it('LIB-FILTER-1 is off when the parameter is absent', () => {
    expect(hasUnread('')).toBe(false);
    expect(hasUnread('?other=1')).toBe(false);
  });
});
