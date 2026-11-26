import type { JSX } from '@solidjs/web';
import { createSignal, flush } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { ArticleBody } from '../src/components/ArticleBody';
import { ArticleListHeader } from '../src/components/ArticleListHeader';
import { ReaderAppearanceMenu } from '../src/components/ReaderAppearanceMenu';
import { SidebarBrand } from '../src/components/SidebarBrand';
import { sidebarCollapsed } from '../src/state';
import { Menu, MenuItem } from '../src/ui';
import { mount, setupInteractions } from './support/list-helpers';

setupInteractions();

const openLightbox = async (
  html = '<p>Post</p><img src="https://example.com/photo.jpg" alt="Sample">'
): Promise<HTMLImageElement> => {
  const container = mount(() => <ArticleBody html={html} />);
  const image = container.querySelector('img') as HTMLImageElement;
  image.click();
  flush();
  await Promise.resolve();
  return image;
};

describe('ImageLightbox focus lifecycle and Tab trap', () => {
  it('focuses close button on open, traps Tab, and restores focus on close', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    await openLightbox();
    const closeBtn = document.querySelector<HTMLButtonElement>(
      '[role="dialog"][aria-label="图片预览"] button[aria-label="关闭"]'
    );
    expect(document.activeElement).toBe(closeBtn);

    const tab = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeBtn);

    closeBtn?.click();
    flush();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('ArticleBody Escape & image keyboard', () => {
  it('closes lightbox on Escape', async () => {
    await openLightbox();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    flush();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('opens from the keyboard and returns focus to the image on close', async () => {
    const container = mount(() => (
      <ArticleBody html='<img src="https://example.com/photo.jpg" alt="Sample">' />
    ));
    const image = container.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('role')).toBe('button');
    expect(image.tabIndex).toBe(0);
    image.focus();
    expect(document.activeElement).toBe(image);

    image.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      })
    );
    flush();
    await Promise.resolve();
    const closeBtn = document.querySelector<HTMLButtonElement>(
      '[role="dialog"][aria-label="图片预览"] button[aria-label="关闭"]'
    );
    expect(closeBtn).not.toBeNull();
    expect(document.activeElement).toBe(closeBtn);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    flush();

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(image);
  });
});

const openMenu = async (
  component: () => JSX.Element,
  label: string
): Promise<{ container: HTMLElement; panel: HTMLElement | null }> => {
  const container = mount(component);
  container
    .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    ?.click();
  flush();
  const panel = container.querySelector<HTMLElement>('[role="menu"]');
  if (panel) panel.style.display = 'block';
  await Promise.resolve();
  return { container, panel };
};

const pressMenuKey = (panel: HTMLElement | null, key: string): void => {
  panel?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
};

const menuButtons = (root: ParentNode) =>
  root.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]');

describe('ReaderAppearanceMenu keyboard accessibility', () => {
  it('exposes menuitem/menuitemradio roles, sub-pages, and arrow navigation', async () => {
    const { container, panel } = await openMenu(
      () => <ReaderAppearanceMenu />,
      '视图选项'
    );
    const items = menuButtons(container);
    expect(items.length).toBeGreaterThan(1);
    expect(document.activeElement).toBe(items[0]);

    pressMenuKey(panel, 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    items[1]?.click();
    flush();
    await Promise.resolve();
    const back = menuButtons(container)[0];
    expect(panel?.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(back);

    const radios = container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitemradio"]'
    );
    expect(radios.length).toBe(2);
    pressMenuKey(panel, 'ArrowDown');
    pressMenuKey(panel, 'ArrowDown');
    expect(document.activeElement).toBe(radios[1]);
    radios[1]?.click();
    flush();
    expect(radios[1]?.getAttribute('aria-checked')).toBe('true');

    pressMenuKey(panel, 'Home');
    expect(document.activeElement).toBe(back);
    back?.click();
    flush();
    await Promise.resolve();
    const restored = menuButtons(container);
    expect(document.activeElement).toBe(restored[1]);
    expect(Array.from(restored).at(-1)?.textContent).toBe('恢复默认');
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="正文宽度 增大"]'
      )?.disabled
    ).toBe(true);
  });
});

describe('Menu disabled items navigation', () => {
  it('skips disabled and aria-disabled items on entry, Arrow, Home, and End', async () => {
    const { container, panel } = await openMenu(
      () => (
        <Menu label="操作">
          <MenuItem disabled>禁用首项</MenuItem>
          <MenuItem>可用一</MenuItem>
          <MenuItem aria-disabled="true">不可用中项</MenuItem>
          <MenuItem>可用二</MenuItem>
          <MenuItem disabled>禁用末项</MenuItem>
        </Menu>
      ),
      '操作'
    );
    const items = menuButtons(container);
    expect(document.activeElement).toBe(items[1]);
    pressMenuKey(panel, 'ArrowDown');
    expect(document.activeElement).toBe(items[3]);
    pressMenuKey(panel, 'ArrowUp');
    expect(document.activeElement).toBe(items[1]);
    pressMenuKey(panel, 'End');
    expect(document.activeElement).toBe(items[3]);
    pressMenuKey(panel, 'Home');
    expect(document.activeElement).toBe(items[1]);
  });
});

describe('Menu subpanel container focus and Escape', () => {
  it('focuses the panel container when empty and restores trigger on Escape', async () => {
    const [sub, setSub] = createSignal<'root' | 'empty'>('root');
    const { container, panel } = await openMenu(
      () => (
        <Menu label="子面板">
          {sub() === 'root' ? (
            <MenuItem submenu onSelect={() => setSub('empty')}>
              打开空面板
            </MenuItem>
          ) : (
            <MenuItem disabled>不可用</MenuItem>
          )}
        </Menu>
      ),
      '子面板'
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="子面板"]'
    );
    menuButtons(container)[0]?.click();
    flush();
    await Promise.resolve();
    expect(document.activeElement).toBe(panel);

    setSub('root');
    flush();
    await Promise.resolve();
    expect(document.activeElement).toBe(menuButtons(container)[0]);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    flush();
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Menu Tab dismissal', () => {
  it('closes the menu on Tab without blocking focus traversal', async () => {
    const { container, panel } = await openMenu(
      () => (
        <Menu label="Tab测试">
          <MenuItem>项目</MenuItem>
        </Menu>
      ),
      'Tab测试'
    );
    pressMenuKey(panel, 'Tab');
    flush();
    expect(container.querySelector('[role="menu"]')).toBeNull();
  });
});

describe('Sidebar collapse and expand focus transfer', () => {
  it('moves focus between collapse and expand buttons', async () => {
    const sidebar = mount(() => <SidebarBrand onNavigate={vi.fn()} />);
    const [unread] = createSignal(false);
    const header = mount(() => (
      <ArticleListHeader
        scope={{ kind: 'all' }}
        unreadOnly={unread()}
        drawerOpen={false}
        onToggleNav={vi.fn()}
        navToggleRef={() => undefined}
        onToggleUnread={vi.fn()}
        onRequestAddLink={vi.fn()}
        onMoveFeed={vi.fn()}
        onRequestNewFolder={vi.fn()}
        onDeleteFeed={vi.fn()}
      />
    ));

    const collapseBtn = sidebar.querySelector<HTMLButtonElement>(
      'button[aria-label="收起侧边栏"]'
    );
    collapseBtn?.click();
    flush();
    await Promise.resolve();

    expect(sidebarCollapsed()).toBe(true);
    const expandBtn = header.querySelector<HTMLButtonElement>(
      'button[aria-label="展开侧边栏"]'
    );
    expect(document.activeElement).toBe(expandBtn);

    expandBtn?.click();
    flush();
    await Promise.resolve();

    expect(sidebarCollapsed()).toBe(false);
    expect(document.activeElement).toBe(collapseBtn);
  });
});
