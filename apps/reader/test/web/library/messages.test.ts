import { describe, expect, it } from 'vitest';
import { emptyActionLabel, emptyCopy } from '../../../src/web/library/messages';

/**
 * The list's empty states (`reader-spec` library.md LIB-STATE-2, with the copy
 * of later.md, feeds.md and folders.md).
 */

describe('the empty state of a scope', () => {
  it('Scenario: An empty saved-page scope invites adding a link', () => {
    const copy = emptyCopy({ kind: 'later' }, false, false);

    expect(copy).toEqual({
      title: '留一篇，慢慢读',
      hint: '保存感兴趣的文章链接，在这里专注阅读。',
      action: 'add-link',
    });
    expect(emptyActionLabel('add-link')).toBe('新增文章链接');
  });

  it('Scenario: An empty all-items scope points at the sidebar', () => {
    expect(emptyCopy({ kind: 'all' }, false, false)).toEqual({
      title: '从一个订阅源开始',
      hint: '添加 RSS 订阅，让新的文章汇集到这里。',
    });
  });

  it('LIB-STATE-2 names a single feed’s state without an action', () => {
    expect(emptyCopy({ kind: 'feed', id: 'feed-1' }, false, false)).toEqual({
      title: '这个订阅源还没有文章',
      hint: '订阅源刷新后，新的文章会出现在这里。',
    });
  });

  it('LIB-STATE-2 tells a folder without feeds from one without articles', () => {
    expect(emptyCopy({ kind: 'folder', id: 'f' }, false, false)).toEqual({
      title: '这个目录还没有订阅源',
      hint: '可以从订阅源的菜单把订阅源移动到这里。',
    });
    expect(emptyCopy({ kind: 'folder', id: 'f' }, false, true)).toEqual({
      title: '这个目录还没有文章',
      hint: '订阅源刷新后，新的文章会出现在这里。',
    });
  });

  it('Scenario: An empty unread list restores all articles', () => {
    const copy = emptyCopy({ kind: 'later' }, true, false);

    expect(copy).toEqual({
      title: '没有未读文章',
      hint: '所有文章都已读过了。',
      action: 'show-all',
    });
    expect(emptyActionLabel('show-all')).toBe('查看全部文章');
  });

  it('LIB-STATE-2 lets the unread filter win over the folder states', () => {
    expect(emptyCopy({ kind: 'folder', id: 'f' }, true, false).title).toBe(
      '没有未读文章'
    );
  });
});
