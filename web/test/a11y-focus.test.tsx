import type { JSX } from '@solidjs/web';
import { render } from '@solidjs/web';
import { createSignal, flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ArticleFrame,
  buildArticleSrcdoc,
} from '../src/components/ArticleFrame';
import { ArticleListHeader } from '../src/components/ArticleListHeader';
import { ReaderAppearanceMenu } from '../src/components/ReaderAppearanceMenu';
import { SidebarBrand } from '../src/components/SidebarBrand';
import { setLocale } from '../src/i18n';
import {
  resetReaderAppearance,
  setSidebarCollapsedState,
  sidebarCollapsed,
} from '../src/state';

let disposers: Array<() => void> = [];

const mount = (component: () => JSX.Element): HTMLElement => {
  const container = document.createElement('div');
  document.body.append(container);
  disposers.push(render(component, container));
  flush();
  return container;
};

const frameToken = (iframe: HTMLIFrameElement): string =>
  /var token = "([^"]+)"/.exec(iframe.getAttribute('srcdoc') ?? '')?.[1] ?? '';

const sendFrameMessage = (iframe: HTMLIFrameElement, data: unknown): void => {
  window.dispatchEvent(
    new MessageEvent('message', { data, source: iframe.contentWindow })
  );
  flush();
};

const openLightbox = async (
  html = '<p>Post</p>'
): Promise<{ iframe: HTMLIFrameElement; token: string }> => {
  const container = mount(() => <ArticleFrame html={html} />);
  const iframe = container.querySelector('iframe') as HTMLIFrameElement;
  const token = frameToken(iframe);
  sendFrameMessage(iframe, {
    type: 'article-frame-image',
    token,
    src: 'https://example.com/photo.jpg',
    alt: 'Sample',
  });
  await Promise.resolve();
  return { iframe, token };
};

beforeEach(() => {
  localStorage.clear();
  setLocale('zh-CN');
  resetReaderAppearance();
  setSidebarCollapsedState(false);
  if (typeof HTMLElement.prototype.showPopover !== 'function') {
    HTMLElement.prototype.showPopover = () => undefined;
  }
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

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

describe('ArticleFrame Escape & image keyboard script', () => {
  it('closes lightbox on bridged Escape without forwarding to window', async () => {
    const seen: Array<string> = [];
    const onKeyDown = (event: KeyboardEvent) => seen.push(event.key);
    window.addEventListener('keydown', onKeyDown);

    const { iframe, token } = await openLightbox();
    sendFrameMessage(iframe, {
      type: 'article-frame-key',
      token,
      key: 'Escape',
    });
    window.removeEventListener('keydown', onKeyDown);

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(seen).toEqual([]);
  });

  it('includes image tabindex/role enhancement and Enter/Space handlers in srcdoc', () => {
    const srcdoc = buildArticleSrcdoc({
      html: '<img src="https://example.com/a.jpg">',
      nonce: 'n1',
      token: 't1',
      appOrigin: 'https://app.example',
    });
    expect(srcdoc).toContain('function enhanceImages()');
    expect(srcdoc).toContain('img.tabIndex = 0');
    expect(srcdoc).toContain("img.setAttribute('role', 'button')");
    expect(srcdoc).toContain("event.key === 'Enter' || event.key === ' '");
  });
});

describe('ReaderAppearanceMenu keyboard accessibility', () => {
  it('exposes menuitem/menuitemradio roles, sub-pages, and arrow navigation', async () => {
    const container = mount(() => <ReaderAppearanceMenu />);
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="视图选项"]'
    );
    trigger?.click();
    flush();
    const panel = container.querySelector<HTMLElement>('[role="menu"]');
    if (panel) panel.style.display = 'block';
    await Promise.resolve();

    const items = container.querySelectorAll<HTMLButtonElement>(
      'button[role="menuitem"]'
    );
    expect(items.length).toBeGreaterThan(1);
    expect(document.activeElement).toBe(items[0]);

    panel?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    );
    expect(document.activeElement).toBe(items[1]);

    items[1]?.click();
    flush();
    const radios = container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitemradio"]'
    );
    expect(radios.length).toBe(2);
    radios[1]?.click();
    flush();
    expect(radios[1]?.getAttribute('aria-checked')).toBe('true');

    container
      .querySelector<HTMLButtonElement>('button[role="menuitem"]')
      ?.click();
    flush();
    expect(
      Array.from(container.querySelectorAll('button[role="menuitem"]')).at(-1)
        ?.textContent
    ).toBe('恢复默认');
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
