import { flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feed } from '../src/api';
import { ArticleListHeader } from '../src/components/ArticleListHeader';
import { ArticleRow } from '../src/components/ArticleRow';
import * as state from '../src/state';
import {
  ariaBtn,
  clickButton,
  mount,
  setupInteractions,
} from './support/list-helpers';

setupInteractions();
let fetchMock: ReturnType<typeof vi.fn>;

const makeFeed = (overrides: Partial<Feed> = {}): Feed => ({
  id: 'f1',
  url: 'https://example.com/feed.xml',
  title: 'Broken Feed',
  folderId: null,
  failureCount: 3,
  lastError: 'Gateway Timeout',
  readerMode: 'default',
  order: 'newest',
  ...overrides,
});

const mountHeader = (
  unreadOnly: boolean,
  options: {
    scope?: state.LibraryScope;
    onToggleUnread?: () => void;
    onDeleteFeed?: (feed: Feed) => void;
  } = {}
): HTMLElement =>
  mount(() => (
    <ArticleListHeader
      scope={options.scope ?? { kind: 'all' }}
      unreadOnly={unreadOnly}
      drawerOpen={false}
      onToggleNav={vi.fn()}
      navToggleRef={() => undefined}
      onToggleUnread={options.onToggleUnread ?? vi.fn()}
      onRequestAddLink={vi.fn()}
      onMoveFeed={vi.fn()}
      onRequestNewFolder={vi.fn()}
      onDeleteFeed={options.onDeleteFeed ?? vi.fn()}
    />
  ));

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  state.clearSidebarState();
});

describe('ArticleListHeader unread toggle', () => {
  it('renders 1-click unread toggle with aria-pressed before mark-loaded-read', () => {
    const onToggleUnread = vi.fn();
    const off = mountHeader(false, { onToggleUnread });
    const unreadBtn = ariaBtn(off, '只显示未读');
    const markReadBtn = ariaBtn(off, '将已加载文章标为已读');
    expect(unreadBtn?.getAttribute('aria-pressed')).toBe('false');
    expect(
      (unreadBtn?.compareDocumentPosition(markReadBtn as Node) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    unreadBtn?.click();
    expect(onToggleUnread).toHaveBeenCalledTimes(1);

    const on = mountHeader(true);
    const activeBtn = ariaBtn(on, '只显示未读');
    expect(activeBtn?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('ArticleListHeader failure menu', () => {
  it('renders failure menu outside heading with delete item calling onDeleteFeed', async () => {
    const feed = makeFeed();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [feed] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 0 })));
    await state.refreshSidebar();

    const onDeleteFeed = vi.fn();
    const container = mountHeader(false, {
      scope: { kind: 'feed', feedId: 'f1' },
      onDeleteFeed,
    });
    const heading = container.querySelector('h2');
    expect(heading?.textContent).toContain('Broken Feed');
    expect(heading?.querySelector('button')).toBeNull();

    const trigger = ariaBtn(container, '重试刷新');
    expect(trigger?.querySelector('[title="Gateway Timeout"]')).not.toBeNull();
    trigger?.click();
    flush();
    expect(container.querySelector('[role="menu"] p')).toBeNull();
    expect(container.textContent).toContain('Gateway Timeout');
    expect(container.textContent).toContain('删除 RSS 源');
    clickButton(container, '删除 RSS 源');
    expect(onDeleteFeed).toHaveBeenCalledWith(feed);
  });
});

describe('ArticleRow feed quick actions', () => {
  it('renders quick actions for feed items and calls save/open handlers', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ item: { id: 'p1' } }), { status: 201 })
    );

    const container = mount(() => (
      <ArticleRow
        row={{
          kind: 'feed',
          id: 'i1',
          feedId: 'f1',
          url: 'https://example.com/i1',
          title: 'Feed Post',
          content: '<p>Body</p>',
          read: false,
        }}
        scope={{ kind: 'all' }}
        unreadOnly={false}
        active={false}
        onNavigate={vi.fn()}
      />
    ));

    expect(ariaBtn(container, '已读')?.getAttribute('aria-pressed')).toBe(
      'false'
    );
    expect(ariaBtn(container, '标为已读')).toBeNull();

    ariaBtn(container, '保存到稍后阅读')?.click();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/feed-items/i1/save',
      expect.objectContaining({ method: 'POST' })
    );

    ariaBtn(container, '打开原文')?.click();
    expect(openSpy).toHaveBeenCalledWith(
      'https://example.com/i1',
      '_blank',
      'noopener,noreferrer'
    );
  });
});

describe('ArticleRow saved page and read toggle', () => {
  it('hides save-to-later for saved pages and keeps read label stable', () => {
    const container = mount(() => (
      <ArticleRow
        row={{
          kind: 'later',
          id: 'p1',
          url: 'https://example.com/p1',
          title: 'Saved Post',
          content: '<p>Body</p>',
          read: true,
        }}
        scope={{ kind: 'later' }}
        unreadOnly={false}
        active={false}
        onNavigate={vi.fn()}
      />
    ));

    expect(ariaBtn(container, '已读')?.getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(ariaBtn(container, '标为未读')).toBeNull();
    expect(ariaBtn(container, '保存到稍后阅读')).toBeNull();
    expect(ariaBtn(container, '打开原文')).not.toBeNull();
  });
});
