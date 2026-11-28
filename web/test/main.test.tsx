import { describe, expect, it, vi } from 'vitest';
import { createAppHarness, json } from './support/app-harness';
import { feedOrder, uuid } from './support/state-fixture';

const harness = createAppHarness({ settleTimes: 1 });
const { respond, respondUnauthenticated, settle, mountApp: mount } = harness;
harness.installHarnessLifecycle();
const mountApp = async (path: string) => {
  const result = mount(path);
  await settle(4);
  return result;
};

const requestUrls = (): Array<string> =>
  harness.fetchMock.mock.calls.map((call) => String(call[0]));

const must = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
};

const typeInto = (root: ParentNode, selector: string, value: string): void => {
  const input = must<HTMLInputElement>(root, selector);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  harness.modules.solid.flush();
};

const submitForm = (root: ParentNode): void => {
  const form = must<HTMLFormElement>(root, 'form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  harness.modules.solid.flush();
};

const submitLogin = async (root: ParentNode, password?: string) => {
  if (password !== undefined)
    typeInto(root, 'input[type="password"]', password);
  submitForm(root);
  await settle(4);
};

describe('app entry', () => {
  it('renders the login route into the #app root', async () => {
    respondUnauthenticated();
    window.history.replaceState({}, '', '/login');

    const root = document.createElement('div');
    root.id = 'app';
    document.body.append(root);

    await import('../src/main');
    await settle(4);

    expect(root.textContent).toContain('Lantern');
    expect(root.textContent).toContain('登录');
    expect(root.querySelector('input[type="password"]')).not.toBeNull();

    root.remove();
  });

  it('redirects the root route and unknown routes to /all', async () => {
    expect((await mountApp('/')).history.get()).toBe('/all');
    expect((await mountApp('/does-not-exist')).history.get()).toBe('/all');
  });

  it('shows only a skeleton on /login until the session check resolves', async () => {
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    harness.fetchMock.mockImplementation((input: unknown) =>
      String(input).includes('/api/auth/session')
        ? pending
        : Promise.resolve(json({ items: [], groups: [], item: null }))
    );

    const { container } = mount('/login');
    await settle(2);
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(
      container.querySelector(
        '[role="status"][aria-label="正在确认登录状态…"] .skeleton'
      )
    ).not.toBeNull();
    expect(container.textContent).not.toContain('正在确认登录状态');

    release(json({ authenticated: false }));
    await settle(4);
    expect(container.querySelector('input[type="password"]')).not.toBeNull();
  });
});

describe('service worker registration', () => {
  it('catches service worker registration failures quietly in production', async () => {
    const env = import.meta.env as { PROD: boolean };
    const previousProd = env.PROD;
    const swDesc = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    const register = vi.fn().mockRejectedValue(new Error('sw rejected'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unhandled = vi.fn();
    window.addEventListener('unhandledrejection', unhandled);
    env.PROD = true;
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register },
    });
    try {
      vi.resetModules();
      await import('../src/main');
      window.dispatchEvent(new Event('load'));
      await settle(2);
      expect(register).toHaveBeenCalledExactlyOnceWith('/sw.js');
      expect(warn).toHaveBeenCalledOnce();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('unhandledrejection', unhandled);
      env.PROD = previousProd;
      if (swDesc) Object.defineProperty(navigator, 'serviceWorker', swDesc);
      else delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    }
  });
});

describe('session guard redirect', () => {
  it('returns to /login when a request reports an expired session', async () => {
    respond((url, init) =>
      url.startsWith('/api/feed-items/') && init.method === 'PATCH'
        ? json({ error: 'Unauthorized' }, 401)
        : undefined
    );

    const { history } = await mountApp('/all?all');

    await harness.modules.state.toggleArticleRead('item-1', true);
    await settle(4);

    expect(history.get()).toBe('/login?next=%2Fall%3Fall');
  });
});

/** The first attempt fails with `InvalidCredentials`, the second one succeeds. */
const respondFailedThenSignedIn = (): void => {
  let attempts = 0;
  let signedIn = false;
  respond((url) => {
    if (url.includes('/api/auth/session')) {
      return json({ authenticated: signedIn });
    }
    if (!url.includes('/api/auth/login')) return undefined;

    attempts += 1;
    if (attempts === 1) return json({ error: 'InvalidCredentials' }, 401);
    signedIn = true;
    return new Response(null, { status: 204 });
  });
};

const panel = (root: ParentNode, name: string): HTMLElement =>
  must<HTMLElement>(root, `[data-panel="${name}"]`);

describe('session guard sign in', () => {
  it('keeps quick-save fragment draft in memory across failed login and returns to /save', async () => {
    respondFailedThenSignedIn();
    const { container, history } = await mountApp(
      '/save#url=https%3A%2F%2Fexample.com%2Fpost%3Fa%3D1%26b%3D2'
    );
    expect(history.get()).toBe('/login?next=%2Fsave');

    await submitLogin(container, 'wrong-password');
    expect(container.textContent).toContain('密码不正确');
    expect(history.get()).toBe('/login?next=%2Fsave');

    await submitLogin(container);
    expect(history.get()).toBe('/save');
    expect(container.textContent).toContain('保存到稍后阅读');
    expect(must<HTMLInputElement>(container, 'input[type="url"]').value).toBe(
      'https://example.com/post?a=1&b=2'
    );
  });
});
describe('session guard login errors', () => {
  it('reports a rate-limited login inline', async () => {
    respond((url) => {
      if (url.includes('/api/auth/login'))
        return json({ error: 'TooManyRequests' }, 429);
      return url.includes('/api/auth/session')
        ? json({ authenticated: false })
        : undefined;
    });

    const { container, history } = await mountApp('/login');
    await submitLogin(container, 'secret');

    expect(container.textContent).toContain('请求过于频繁，请稍后重试');
    expect(history.get()).toBe('/login');
  });

  it('requires a password before submitting', async () => {
    respondUnauthenticated();

    const { container } = await mountApp('/login');
    await submitLogin(container);

    expect(container.textContent).toContain('请输入密码。');
    const sentLogin = requestUrls().some((u) => u.includes('/api/auth/login'));
    expect(sentLogin).toBe(false);
  });
});

/** `LIB-RELOAD-1`: the first list page request for the active scope. */
const listPages = (): ReadonlyArray<string> =>
  requestUrls().filter((url) => url.startsWith('/api/feed-items/order?'));

describe('library layout', () => {
  it('renders the responsive three-panel layout and loads the route scope', async () => {
    const { container } = await mountApp('/all/item-1');

    for (const name of ['sidebar', 'list', 'reader']) panel(container, name);
    expect(
      must(container, '[aria-label="切换导航"]').closest('[data-panel="list"]')
    ).not.toBeNull();

    const urls = requestUrls();
    // A malformed article ID is never sent as `keep`, so the list still loads.
    expect(listPages()).toEqual(['/api/feed-items/order?unread=true']);
    expect(urls.some((u) => u.startsWith('/api/feed-items/item-1'))).toBe(true);
    expect(urls).toContain('/api/feeds');
    expect(urls).toContain('/api/folders');
  });
});

describe('library panels', () => {
  it('moves focus out of a panel that the route change hid', async () => {
    const { container, history } = await mountApp('/all');
    const listPanel = panel(container, 'list');
    const readerPanel = panel(container, 'reader');
    listPanel.focus();
    listPanel.style.display = 'none';
    expect(document.activeElement).toBe(listPanel);

    history.set({ value: '/all/item-1' });
    await settle(4);
    expect(document.activeElement).toBe(readerPanel);
    expect(listPanel.style.display).toBe('none');
  });
});

describe('library reload', () => {
  it('does not reload the list when only the open article changes', async () => {
    const { history } = await mountApp('/all');
    const before = listPages().length;
    history.set({ value: '/all/item-1' });
    await settle(4);
    expect(listPages()).toHaveLength(before);
  });

  it('keeps the library shell mounted when switching scope', async () => {
    const { container, history } = await mountApp('/all');
    const shell = must<HTMLElement>(container, 'aside');
    for (const path of ['/later', '/feed/feed-1', '/folder/folder-1', '/all']) {
      history.set({ value: path });
      await settle(4);
      expect(shell.isConnected).toBe(true);
    }
  });

  it('does not fetch content when the list has no measurable layout', async () => {
    const item = {
      id: uuid(1),
      feedId: uuid(100),
      url: 'https://example.com/item-1',
      title: 'Item 1',
      description: 'Summary',
      content: '<p>Body</p>',
      read: false,
    };
    const items = [
      item,
      ...Array.from({ length: 30 }, (_, index) => ({
        ...item,
        id: uuid(index + 2),
      })),
    ];
    respond((url) => {
      if (url.startsWith('/api/feed-items/order?'))
        return json(feedOrder(items));
      if (url.startsWith('/api/feed-items?ids=')) return json({ items: items });
      return undefined;
    });
    await mountApp('/all');
    expect(listPages()).toHaveLength(1);
    expect(
      requestUrls().filter((url) => url.startsWith('/api/feed-items?ids='))
    ).toHaveLength(0);
  });
});
