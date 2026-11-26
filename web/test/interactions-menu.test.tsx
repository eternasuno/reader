import { flush } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { Feed } from '../src/api';
import { ArticleListHeader } from '../src/components/ArticleListHeader';
import { FeedMoveSubpanel } from '../src/components/FeedMoveSubpanel';
import { ReaderMoreMenu } from '../src/components/ReaderMoreMenu';
import * as state from '../src/state';
import {
  ariaBtn,
  clickAria,
  clickButton,
  mount,
  setupInteractions,
} from './support/list-helpers';

setupInteractions();

const makeNav = (onNavigate = vi.fn()) => ({
  listUrl: () => '/later',
  laterUrl: () => '/later',
  articleUrl: (id: string) => `/later/${id}`,
  onNavigate,
});

const makeFeedArticle = (id: string): state.LibraryArticle => ({
  kind: 'feed',
  id,
  feedId: 'f1',
  url: `https://example.com/${id}`,
  title: 'Feed Post',
  content: '<p>Body</p>',
  read: false,
});

const mountHeader = (unreadOnly: boolean, onToggleUnread = vi.fn()) =>
  mount(() => (
    <ArticleListHeader
      scope={{ kind: 'all' }}
      unreadOnly={unreadOnly}
      drawerOpen={false}
      onToggleNav={vi.fn()}
      navToggleRef={() => undefined}
      onToggleUnread={onToggleUnread}
      onRequestAddLink={vi.fn()}
      onMoveFeed={vi.fn()}
      onRequestNewFolder={vi.fn()}
      onDeleteFeed={vi.fn()}
    />
  ));

describe('ArticleListHeader', () => {
  it('toggles unread filter and offers 从旧到新 at the top level of the header menu', () => {
    const onToggleUnread = vi.fn();
    const c1 = mountHeader(false, onToggleUnread);
    clickAria(c1, '更多操作');
    const unreadCheckbox = c1.querySelector<HTMLButtonElement>(
      '[role="menuitemcheckbox"]'
    );
    expect(unreadCheckbox?.getAttribute('aria-checked')).toBe('false');
    unreadCheckbox?.click();
    expect(onToggleUnread).toHaveBeenCalledTimes(1);

    expect(c1.textContent).toContain('从旧到新');
    expect(c1.textContent).not.toContain('视图选项');
    expect(c1.textContent).not.toContain('摘要行数');
    expect(c1.textContent).not.toContain('刷新');
  });
});

const stubPendingMarkAll = () => {
  const boundary = '019363b8-0000-7000-8000-000000000001';
  const pendingReads: Array<() => void> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      if (url === '/api/feed-items/read-all') {
        return new Promise<Response>((resolve) => {
          pendingReads.push(() => resolve(new Response(null, { status: 204 })));
        });
      }
      if (url === '/api/feeds/unread-counts')
        return Promise.resolve(Response.json({ items: [], boundary }));
      if (url === '/api/saved-pages/unread-count')
        return Promise.resolve(Response.json({ count: 0, boundary }));
      return Promise.resolve(
        Response.json({ items: [], cursor: null, boundary })
      );
    })
  );
  return pendingReads;
};

describe('ArticleListHeader mark-all indicator', () => {
  it('shows heading mark-all indicator while pending, keeps controls enabled, and supports repeat clicks', async () => {
    const pendingReads = stubPendingMarkAll();
    const c = mountHeader(false);
    clickAria(c, '更多操作');
    clickButton(c, '全部标记为已读');
    await vi.waitFor(() => expect(pendingReads).toHaveLength(1));
    flush();

    const busySel = '[role="status"][aria-busy="true"].loading-spinner';
    expect(c.querySelector(busySel)).not.toBeNull();
    expect(ariaBtn(c, '将已加载文章标为已读')?.disabled).toBe(false);

    clickAria(c, '更多操作');
    const markBtn = Array.from(c.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('全部标记为已读')
    );
    expect(markBtn?.disabled).toBe(false);
    markBtn?.click();
    flush();

    pendingReads[0]?.();
    await vi.waitFor(() => expect(pendingReads).toHaveLength(2));
    flush();
    expect(c.querySelector(busySel)).not.toBeNull();

    pendingReads[1]?.();
    await vi.waitFor(() => expect(c.querySelector(busySel)).toBeNull());
  });
});

describe('ReaderMoreMenu 视图选项 sub-panel', () => {
  it('opens view options, steps values, picks font, and resets', () => {
    const container = mount(() => (
      <ReaderMoreMenu
        article={makeFeedArticle('i1')}
        nav={makeNav()}
        onDelete={vi.fn()}
        onRequestFeedOptions={vi.fn()}
      />
    ));
    clickAria(container, '更多操作');
    clickButton(container, '视图选项');
    for (const label of ['字体大小 增大', '行高 增大', '正文宽度 减小']) {
      clickAria(container, label);
    }
    expect(state.readerAppearance()).toMatchObject({
      fontSize: 18,
      lineHeight: 2.0,
      lineWidth: 5,
    });

    clickButton(container, '字体');
    const radios = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    );
    expect(radios.map((r) => r.textContent)).toEqual(['无衬线', '衬线']);
    radios[1]?.click();
    expect(state.readerAppearance().fontFamily).toBe('serif');

    clickButton(container, '字体');
    clickButton(container, '恢复默认');
    expect(state.isDefaultAppearance()).toBe(true);
  });
});

describe('FeedMoveSubpanel', () => {
  it('goes back and opens the new-folder dialog', () => {
    const onBack = vi.fn();
    const onRequestNewFolder = vi.fn();
    const container = mount(() => (
      <FeedMoveSubpanel
        feed={{ id: 'f1', folderId: null } as unknown as Feed}
        onBack={onBack}
        onMove={vi.fn()}
        onRequestNewFolder={onRequestNewFolder}
      />
    ));

    expect(container.textContent).toContain('移动到');
    clickButton(container, '移动到');
    expect(onBack).toHaveBeenCalledTimes(1);
    clickButton(container, '新建目录');
    expect(onRequestNewFolder).toHaveBeenCalledTimes(1);
    expect(onRequestNewFolder).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'f1' })
    );
  });
});
