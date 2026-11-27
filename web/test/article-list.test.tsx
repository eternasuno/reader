import { flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feed } from '../src/api';
import { ArticleListHeader } from '../src/components/ArticleListHeader';
import { ArticleListPane } from '../src/components/ArticleListPane';
import { ArticleRow } from '../src/components/ArticleRow';
import * as state from '../src/state';
import {
  ariaBtn,
  clickButton,
  mount,
  setupInteractions,
} from './support/list-helpers';
import { jsonResponse, makePage, uuid } from './support/state-fixture';
import { installResizeObserver, sizeScroller } from './support/virtual-helpers';

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
  state.clearLibraryState();
  vi.unstubAllGlobals();
});

const scope = { kind: 'later' } as const;
const boundary = uuid(2000);

const mountPane = (): HTMLElement =>
  mount(() => (
    <ArticleListPane
      scope={scope}
      openArticleId={null}
      unreadOnly={false}
      drawerOpen={false}
      onToggleNav={vi.fn()}
      navToggleRef={vi.fn()}
      onNavigate={vi.fn()}
      onRequestAddLink={vi.fn()}
      onRequestAddFeed={vi.fn()}
      onMoveFeed={vi.fn()}
      onRequestNewFolder={vi.fn()}
    />
  ));

it('shows initial loading and offers a snapshot retry after failure', async () => {
  const snapshot = Promise.withResolvers<Response>();
  fetchMock.mockReturnValueOnce(snapshot.promise);
  const load = state.loadScopeFirstPage(scope, false);
  const container = mountPane();
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  expect(container.querySelector('[role="alert"]')).toBeNull();

  snapshot.resolve(jsonResponse({ error: 'RequestFailed' }, 500));
  await load;
  const alert = container.querySelector('[role="alert"]');
  if (alert === null) throw new Error('missing snapshot error');

  expect(alert.textContent).toContain('暂时无法加载文章');
  expect(alert.textContent).toContain('请点击上方重试。');
  expect(container.querySelector('[role="status"]')).toBeNull();
  fetchMock.mockResolvedValueOnce(jsonResponse({ ids: [], boundary }));
  clickButton(alert, '重试');
  await vi.waitFor(() => expect(state.listBoundary()).toBe(boundary));
  expect(fetchMock.mock.calls[1]?.[0]).toBe(fetchMock.mock.calls[0]?.[0]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

const mountSizedPane = (
  notifyResize: ReturnType<typeof installResizeObserver>
) => {
  const container = mountPane();
  const scroller = container.querySelector<HTMLDivElement>('.overflow-y-auto');
  if (scroller === null) throw new Error('missing scroller');

  sizeScroller(scroller, 600);
  notifyResize(scroller, 600);
  flush();

  return { container, scroller };
};

it('shows a compact window retry above the list and keeps its rows mounted', async () => {
  const notifyResize = installResizeObserver();
  const cached = makePage({ id: uuid(1007), title: 'Cached page' });
  const pending = makePage({ id: uuid(1008), title: 'Pending page' });
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ ids: [pending.id], boundary })
  );
  await state.loadScopeFirstPage(scope, false);
  state.insertSavedPageLocal(cached);
  flush();
  const batch = Promise.withResolvers<Response>();
  fetchMock.mockReturnValueOnce(batch.promise);
  const { container, scroller } = mountSizedPane(notifyResize);
  const cachedLink = scroller.querySelector(`a[href*="${cached.id}"]`);
  expect(cachedLink?.textContent).toContain(cached.title);
  expect(container.querySelector('[role="alert"]')).toBeNull();

  batch.resolve(jsonResponse({ error: 'RequestFailed' }, 500));
  await vi.waitFor(() =>
    expect(container.querySelector('[role="alert"]')).not.toBeNull()
  );
  const alert = container.querySelector('[role="alert"]');
  if (alert === null) throw new Error('missing window error');

  expect(alert.textContent).toContain('暂时无法加载文章');
  expect(alert.textContent).not.toContain('请点击上方重试。');
  expect(alert.nextElementSibling).toBe(scroller);
  expect(scroller.querySelector(`a[href*="${cached.id}"]`)).toBe(cachedLink);
  expect(scroller.querySelector('[data-index="1"] .skeleton')).not.toBeNull();

  fetchMock.mockResolvedValueOnce(jsonResponse({ items: [pending] }));
  clickButton(alert, '重试');
  await vi.waitFor(() => expect(scroller.textContent).toContain(pending.title));
  expect(fetchMock.mock.calls.slice(1).map(([url]) => url)).toEqual([
    `/api/saved-pages?ids=${pending.id}`,
    `/api/saved-pages?ids=${pending.id}`,
  ]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

describe('ArticleListHeader unread toggle', () => {
  it('renders 1-click unread toggle with aria-pressed before mark-loaded-read', () => {
    const onToggleUnread = vi.fn();
    const off = mountHeader(false, { onToggleUnread });
    const unreadBtn = ariaBtn(off, '只显示未读');
    const markReadBtn = ariaBtn(off, '将以上文章标为已读');
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

describe('ArticleRow feed read toggle', () => {
  it('renders a stable read toggle and no hover quick actions', () => {
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
    expect(ariaBtn(container, '保存到稍后阅读')).toBeNull();
    expect(ariaBtn(container, '打开原文')).toBeNull();
  });
});

describe('ArticleRow saved page and read toggle', () => {
  it('keeps the read label stable for saved pages', () => {
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
  });
});
