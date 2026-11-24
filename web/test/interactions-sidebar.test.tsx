import { createSignal, flush } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { SidebarBrand } from '../src/components/SidebarBrand';
import { SidebarFeedTree } from '../src/components/SidebarFeedTree';
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

const seedTree = async (): Promise<void> => {
  fetchMock
    .mockResolvedValueOnce(
      Response.json({
        items: [
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
        ],
      })
    )
    .mockResolvedValueOnce(
      Response.json({ items: [{ id: 'dir-1', name: 'Tech' }] })
    )
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
