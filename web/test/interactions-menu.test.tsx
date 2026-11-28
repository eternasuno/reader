import { flush } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { Feed } from '../src/api';
import { ArticleListHeader } from '../src/components/ArticleListHeader';
import { FeedMoveSubpanel } from '../src/components/FeedMoveSubpanel';
import { FeedReaderModeSubpanel } from '../src/components/FeedReaderModeSubpanel';
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

const makeFeedArticle = (id: string): state.LibraryArticle => ({
  kind: 'feed',
  id,
  feedId: 'f1',
  url: `https://example.com/${id}`,
  title: 'Feed Post',
  content: '<p>Body</p>',
  read: false,
});

const mountHeader = (
  unreadOnly: boolean,
  onToggleUnread = vi.fn(),
  scope: state.LibraryScope = { kind: 'all' }
) =>
  mount(() => (
    <ArticleListHeader
      scope={scope}
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
  it.each([
    { kind: 'later' },
    { kind: 'folder', folderId: 'folder' },
  ] satisfies Array<state.LibraryScope>)(
    'omits the order toggle from the $kind menu',
    (scope) => {
      const container = mountHeader(false, vi.fn(), scope);
      clickAria(container, '更多操作');
      const menu = container.querySelector('[role="menu"]');
      expect(menu?.textContent).toContain('全部标记为已读');
      expect(menu?.textContent).not.toContain('从旧到新');
    }
  );

  it('toggles unread filter from the header button and omits the order toggle from the all-feeds menu', () => {
    const onToggleUnread = vi.fn();
    const c1 = mountHeader(true, onToggleUnread);
    expect(ariaBtn(c1, '只显示未读')?.getAttribute('aria-pressed')).toBe(
      'true'
    );
    clickAria(c1, '只显示未读');
    expect(onToggleUnread).toHaveBeenCalledTimes(1);

    clickAria(c1, '更多操作');
    expect(c1.querySelector('[role="menu"]')?.textContent).not.toContain(
      '只显示未读'
    );

    expect(c1.textContent).not.toContain('从旧到新');
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
        Response.json({ items: [], groups: [], boundary })
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
    expect(ariaBtn(c, '将以上文章标为已读')?.disabled).toBe(false);

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
  const radioLabels = (c: HTMLElement): Array<string | null> =>
    Array.from(
      c.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    ).map((r) => r.textContent);

  const pick = (c: HTMLElement, row: string, option: string): void => {
    clickButton(c, row);
    const radio = Array.from(
      c.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    ).find((r) => r.textContent === option);
    radio?.click();
    clickButton(c, row);
  };

  it('picks tiered values, has no more-options item, and resets', () => {
    const container = mount(() => (
      <ReaderMoreMenu article={makeFeedArticle('i1')} onDelete={vi.fn()} />
    ));
    clickAria(container, '更多操作');
    clickButton(container, '视图选项');
    expect(container.textContent).not.toContain('更多选项');

    clickButton(container, '字体大小');
    expect(radioLabels(container)).toEqual(['小', '中', '大', '特大']);
    clickButton(container, '字体大小');

    pick(container, '字体大小', '大');
    pick(container, '行高', '宽松');
    pick(container, '正文宽度', '适中');
    pick(container, '字体', '衬线');
    expect(state.readerAppearance()).toEqual({
      fontSize: 'lg',
      fontFamily: 'serif',
      lineHeight: 'relaxed',
      lineWidth: 'medium',
    });

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

describe('FeedReaderModeSubpanel', () => {
  it('offers only the stored views, saves a new pick, and goes back', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    const onBack = vi.fn();
    const feed = { id: 'f1', readerMode: 'default' } as unknown as Feed;
    const container = mount(() => (
      <FeedReaderModeSubpanel feed={feed} onBack={onBack} />
    ));

    const radios = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    );
    expect(radios.map((r) => r.textContent)).toEqual([
      '订阅源文本',
      '网页全文',
    ]);
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true');

    radios[0]?.click();
    expect(fetchMock).not.toHaveBeenCalled();

    radios[1]?.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('/api/feeds/f1/reader-mode');
    expect(JSON.parse(String(init?.body))).toEqual({ readerMode: 'extracted' });

    clickButton(container, '缺省视图');
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
