import type { JSX } from '@solidjs/web';
import { render } from '@solidjs/web';
import { flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feed } from '../src/api';
import { ArticleFrame, KeyboardShortcutsDialog } from '../src/components';
import { ArticleListHeader } from '../src/components/ArticleListHeader';
import { FeedMoveSubpanel } from '../src/components/FeedMoveSubpanel';
import { ReaderMoreMenu } from '../src/components/ReaderMoreMenu';
import { setLocale } from '../src/i18n';
import * as state from '../src/state';
import { dismissToast } from '../src/ui';

let disposers: Array<() => void> = [];
let fetchMock: ReturnType<typeof vi.fn>;

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

const mountFrame = () => {
  const container = mount(() => <ArticleFrame html="<p>Post</p>" />);
  const iframe = container.querySelector('iframe') as HTMLIFrameElement;
  return { iframe, token: frameToken(iframe) };
};

const openLightbox = () => {
  const frame = mountFrame();
  sendFrameMessage(frame.iframe, {
    type: 'article-frame-image',
    token: frame.token,
    src: 'https://example.com/photo.jpg',
    alt: 'Sample photo',
  });
  return frame;
};

const makeNav = (onNavigate = vi.fn()) => ({
  listUrl: () => '/later',
  laterUrl: () => '/later',
  articleUrl: (id: string) => `/later/${id}`,
  onNavigate,
});

const ariaBtn = (root: ParentNode, label: string): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

const clickAria = (root: ParentNode, label: string): void => {
  ariaBtn(root, label)?.click();
  flush();
};

const lightbox = (): Element | null =>
  document.querySelector('[role="dialog"][aria-label="图片预览"]');

const clickButton = (root: ParentNode, text: string): void => {
  const match = Array.from(root.querySelectorAll('button')).find((btn) =>
    btn.textContent?.includes(text)
  );
  match?.click();
  flush();
};

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

beforeEach(() => {
  localStorage.clear();
  setLocale('zh-CN');
  state.resetReaderAppearance();
  state.setSidebarCollapsedState(false);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  if (typeof HTMLElement.prototype.showPopover !== 'function') {
    HTMLElement.prototype.showPopover = () => undefined;
  }
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  document.body.innerHTML = '';
  dismissToast();
  vi.restoreAllMocks();
});

describe('ArticleFrame lightbox', () => {
  it('opens ImageLightbox on valid image message and closes on Escape', () => {
    openLightbox();
    expect(lightbox()?.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.com/photo.jpg'
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    );
    flush();
    expect(lightbox()).toBeNull();
  });

  it('closes ImageLightbox when clicking the close button', () => {
    openLightbox();
    clickAria(document, '关闭');
    expect(lightbox()).toBeNull();
  });
});

describe('ArticleFrame key forwarding', () => {
  it('forwards valid article-frame-key as window keydown when lightbox is closed', () => {
    const { iframe, token } = mountFrame();
    const seen: Array<string> = [];
    const onKeyDown = (e: KeyboardEvent) => seen.push(e.key);
    window.addEventListener('keydown', onKeyDown);
    sendFrameMessage(iframe, { type: 'article-frame-key', token, key: 'j' });
    expect(seen).toEqual(['j']);

    sendFrameMessage(iframe, {
      type: 'article-frame-image',
      token,
      src: 'https://example.com/photo.jpg',
    });
    sendFrameMessage(iframe, { type: 'article-frame-key', token, key: 'k' });
    window.removeEventListener('keydown', onKeyDown);
    expect(seen).toEqual(['j']);
  });
});

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

  it('renders expand sidebar button when sidebarCollapsed is true', () => {
    const container = mountHeader(false);
    expect(ariaBtn(container, '展开侧边栏')).toBeNull();

    state.setSidebarCollapsedState(true);
    const expandBtn = ariaBtn(container, '展开侧边栏');
    expect(expandBtn).not.toBeNull();
    expandBtn?.click();
    expect(state.sidebarCollapsed()).toBe(false);
  });
});

describe('KeyboardShortcutsDialog', () => {
  it('renders shortcut keys when open is true', () => {
    mount(() => <KeyboardShortcutsDialog open={true} onClose={vi.fn()} />);
    const keys = Array.from(
      document.querySelectorAll('[role="dialog"] kbd'),
      (node) => node.textContent
    );
    expect(keys).toEqual(['j', 'k', 'm', 's', 'f', 'v', 'u', '[', 'Esc', '?']);
  });
});

describe('ReaderMoreMenu 视图选项 sub-panel', () => {
  it('opens view options, steps values, picks font, and resets', () => {
    const container = mount(() => (
      <ReaderMoreMenu
        article={makeFeedArticle('i1')}
        nav={makeNav()}
        onDelete={vi.fn()}
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
  });
});
