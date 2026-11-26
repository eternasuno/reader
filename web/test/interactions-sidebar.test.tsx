import { createSignal, flush } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { SidebarBrand } from '../src/components/SidebarBrand';
import { SidebarFeedTree } from '../src/components/SidebarFeedTree';
import { SidebarScopes } from '../src/components/SidebarScopes';
import type { SidebarProps } from '../src/components/sidebarProps';
import * as state from '../src/state';
import {
  ariaBtn,
  clickAria,
  clickButton,
  mount,
  setupInteractions,
} from './support/list-helpers';

setupInteractions();
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

const sidebarProps = (overrides: Partial<SidebarProps> = {}): SidebarProps => ({
  scope: { kind: 'all' },
  unreadOnly: false,
  onNavigate: vi.fn(),
  onRequestAddFeed: vi.fn(),
  onRequestNewFolder: vi.fn(),
  onRequestRenameFolder: vi.fn(),
  onMoveFeed: vi.fn(),
  onRequestImportOpml: vi.fn(),
  onRequestAddLink: vi.fn(),
  ...overrides,
});

const SEEDED_FEEDS = [
  {
    id: 'f-top',
    url: 'https://example.com/top.xml',
    title: 'Top Feed',
    folderId: null,
    failureCount: 0,
    readerMode: 'default',
    order: 'newest',
  },
  {
    id: 'f-nested',
    url: 'https://example.com/nested.xml',
    title: 'Nested Feed',
    folderId: 'dir-1',
    failureCount: 3,
    lastError: 'Upstream 502',
    readerMode: 'default',
    order: 'newest',
  },
];

const SEEDED_FOLDERS = [{ id: 'dir-1', name: 'Tech' }];

const seedTree = async (): Promise<void> => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ items: SEEDED_FEEDS }))
    .mockResolvedValueOnce(Response.json({ items: SEEDED_FOLDERS }))
    .mockResolvedValueOnce(Response.json({ items: [] }))
    .mockResolvedValueOnce(Response.json({ count: 0 }));
  await state.refreshSidebar();
  flush();
};

it('keeps feed row menu open when toggling order or unread filter', async () => {
  await seedTree();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

  const [unreadOnly, setUnreadOnly] = createSignal(false);
  const onNavigate = vi.fn((url: string) => {
    setUnreadOnly(url.includes('unread=true') || url.includes('?unread'));
  });
  const props: SidebarProps = {
    ...sidebarProps({ onNavigate }),
    get unreadOnly() {
      return unreadOnly();
    },
  };

  const container = mount(() => <SidebarFeedTree state={props} />);
  const moreButtons = Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="更多操作"]'
    )
  );
  expect(moreButtons).toHaveLength(4);
  moreButtons[3]?.click();
  flush();
  expect(container.querySelector('[role="menu"]')).not.toBeNull();
  expect(container.textContent).toContain('删除 RSS 源');

  clickButton(container, '从旧到新');
  await Promise.resolve();
  flush();
  expect(container.querySelector('[role="menu"]')).not.toBeNull();

  clickButton(container, '只显示未读');
  flush();
  expect(onNavigate).toHaveBeenCalledWith('/all?unread');
  expect(container.querySelector('[role="menu"]')).not.toBeNull();

  moreButtons[2]?.click();
  flush();
  clickButton(container, '从旧到新');
  await Promise.resolve();
  flush();
  expect(container.querySelector('[role="menu"]')).not.toBeNull();
});

it('exposes folder collapse label with aria-controls, failure title, and OPML menu labels', async () => {
  await seedTree();
  const container = mount(() => <SidebarFeedTree state={sidebarProps()} />);

  const collapseBtn = ariaBtn(container, '收起 Tech');
  expect(collapseBtn?.getAttribute('aria-expanded')).toBe('true');
  const controlsId = collapseBtn?.getAttribute('aria-controls');
  expect(controlsId).toBeTruthy();
  expect(
    container.querySelector(`#${CSS.escape(controlsId ?? '')}`)
  ).not.toBeNull();

  collapseBtn?.click();
  flush();
  expect(ariaBtn(container, '展开 Tech')).not.toBeNull();

  const failTrigger = ariaBtn(container, '重试刷新');
  expect(failTrigger?.querySelector('[title="Upstream 502"]')).not.toBeNull();

  const headerMore = container.querySelector<HTMLButtonElement>(
    'button[aria-label="更多操作"]'
  );
  headerMore?.click();
  flush();
  expect(container.textContent).toContain('导入…');
  expect(container.textContent).toContain('导出…');
});

it('renders a single role="alert" on sign-out failure', async () => {
  fetchMock.mockResolvedValueOnce(
    Response.json({ error: 'RequestFailed' }, { status: 500 })
  );
  const container = mount(() => <SidebarBrand onNavigate={vi.fn()} />);
  clickAria(container, '应用菜单');
  clickButton(container, '退出登录');
  await new Promise((resolve) => setTimeout(resolve, 0));
  flush();

  const alerts = container.querySelectorAll('[role="alert"]');
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.textContent).toContain('退出失败，请重试');
});

const stubSidebarMarkAll = () => {
  const boundary = '019363b8-0000-7000-8000-000000000001';
  let resolveReadAll: (() => void) | undefined;
  fetchMock.mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.endsWith('/read-all')) {
      return new Promise<Response>((resolve) => {
        resolveReadAll = () => resolve(new Response(null, { status: 204 }));
      });
    }
    // The post-success sidebar refresh must see the same tree the server still holds.
    if (url === '/api/feeds')
      return Promise.resolve(Response.json({ items: SEEDED_FEEDS }));
    if (url === '/api/folders')
      return Promise.resolve(Response.json({ items: SEEDED_FOLDERS }));
    if (url === '/api/saved-pages/unread-count')
      return Promise.resolve(Response.json({ count: 0, boundary }));
    if (url === '/api/feeds/unread-counts')
      return Promise.resolve(Response.json({ items: [], boundary }));
    return Promise.resolve(
      Response.json({ items: [], cursor: null, boundary })
    );
  });
  return {
    hasReadAll: () => resolveReadAll !== undefined,
    resolveReadAll: () => resolveReadAll?.(),
  };
};

it('shows and clears the mark-all spinner on the marked sidebar ScopeRow and FeedRow', async () => {
  await seedTree();
  const stub = stubSidebarMarkAll();
  const container = mount(() => (
    <div>
      <SidebarScopes state={sidebarProps()} />
      <SidebarFeedTree state={sidebarProps()} />
    </div>
  ));
  const moreButtons = Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="更多操作"]'
    )
  );
  const busySel = '[role="status"][aria-busy="true"].loading-spinner';
  moreButtons[1]?.click();
  flush();
  clickButton(container, '全部标记为已读');
  await vi.waitFor(() => expect(stub.hasReadAll()).toBe(true));
  expect(container.querySelector(busySel)).not.toBeNull();
  expect(
    container.querySelector(busySel)?.closest('div.group')?.textContent
  ).toContain('稍后阅读');

  stub.resolveReadAll();
  await vi.waitFor(() => expect(container.querySelector(busySel)).toBeNull());

  const topFeedRow = (): HTMLElement | undefined =>
    Array.from(container.querySelectorAll<HTMLElement>('div.group')).find(
      (row) => row.querySelector('button')?.textContent?.includes('Top Feed')
    );
  expect(topFeedRow()).toBeDefined();
  topFeedRow()
    ?.querySelector<HTMLButtonElement>('button[aria-label="更多操作"]')
    ?.click();
  flush();
  clickButton(container, '全部标记为已读');
  await vi.waitFor(() =>
    expect(topFeedRow()?.querySelector(busySel)).toBeTruthy()
  );
  state.markUnauthenticated();
  flush();
  expect(container.querySelector(busySel)).toBeNull();
});
