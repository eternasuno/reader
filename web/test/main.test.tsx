import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FetchHandler = (url: string, init: RequestInit) => Response | undefined;

const load = async () => {
  vi.resetModules();
  return {
    solid: await import('solid-js'),
    web: await import('@solidjs/web'),
    router: await import('@solidjs/router'),
    api: await import('../src/api'),
    state: await import('../src/state'),
    i18n: await import('../src/i18n'),
    ui: await import('../src/ui'),
    routes: await import('../src/routes'),
    app: await import('../src/App'),
  };
};

type Harness = Awaited<ReturnType<typeof load>>;

let h: Harness;
let fetchMock: ReturnType<typeof vi.fn>;
let disposers: Array<() => void> = [];

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const respond = (handler: FetchHandler = () => undefined): void => {
  fetchMock.mockImplementation((input: unknown, init: unknown) => {
    const url = String(input);
    const custom = handler(url, (init ?? {}) as RequestInit);

    return Promise.resolve(custom ?? json(defaultBody(url)));
  });
};

/** Default bodies keep every background loader quiet unless a test overrides them. */
const defaultBody = (url: string): unknown => {
  if (url.includes('/api/auth/session')) return { authenticated: true };
  if (url.includes('/api/kindle/sends')) return { running: false, items: [] };
  if (url.includes('/api/saved-pages/unread-count')) return { count: 0 };
  if (url.includes('/api/feeds/unread-counts')) return { items: [] };
  if (url.includes('/api/settings')) return { retention: 100 };

  return { items: [], cursor: null, item: null };
};

const requestUrls = (): Array<string> =>
  fetchMock.mock.calls.map((call) => String(call[0]));

const settle = async (times = 1): Promise<void> => {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.solid.flush();
  }
};

const mountApp = (path: string) => {
  const history = h.router.memoryHistory(path);
  const router = h.routes.createAppRouter(history);
  const container = document.createElement('div');
  document.body.append(container);
  disposers.push(
    h.web.render(
      () => h.solid.createComponent(h.app.App, { router }),
      container
    )
  );
  h.solid.flush();

  return { container, history };
};

const must = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`missing ${selector}`);

  return found;
};

const typeInto = (root: ParentNode, selector: string, value: string): void => {
  const input = must<HTMLInputElement>(root, selector);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  h.solid.flush();
};

const submitForm = (root: ParentNode): void => {
  const form = must<HTMLFormElement>(root, 'form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  h.solid.flush();
};

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  respond();
  h = await load();
  h.i18n.setLocale('zh-CN');
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  h?.ui.dismissToast();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('app entry', () => {
  it('renders the login route into the #app root', async () => {
    respond((url) =>
      url.includes('/api/auth/session')
        ? json({ authenticated: false })
        : undefined
    );
    window.history.replaceState({}, '', '/login');

    const root = document.createElement('div');
    root.id = 'app';
    document.body.append(root);

    await import('../src/main');
    await settle(4);

    expect(root.textContent).toContain('留白');
    expect(root.textContent).toContain('登录');
    expect(root.querySelector('input[type="password"]')).not.toBeNull();

    root.remove();
  });

  it('redirects the root route and unknown routes to /later', async () => {
    const root = mountApp('/');
    await settle(4);
    expect(root.history.get()).toBe('/later');

    const unknown = mountApp('/does-not-exist');
    await settle(4);
    expect(unknown.history.get()).toBe('/later');
  });
});

describe('session guard redirect', () => {
  it('sends unauthenticated visitors to /login with the encoded next path', async () => {
    respond((url) =>
      url.includes('/api/auth/session')
        ? json({ authenticated: false })
        : undefined
    );

    const next = '/save?url=https%3A%2F%2Fexample.com%2Fpost%3Fa%3D1%26b%3D2';
    const { history, container } = mountApp(next);
    await settle(4);

    expect(history.get()).toBe(`/login?next=${encodeURIComponent(next)}`);
    expect(container.textContent).toContain('登录');
  });

  it('returns to /login when a request reports an expired session', async () => {
    respond((url, init) =>
      url.startsWith('/api/feed-items/') && init.method === 'PATCH'
        ? json({ error: 'Unauthorized' }, 401)
        : undefined
    );

    const { history } = mountApp('/all?unread');
    await settle(4);

    await h.state.toggleArticleRead('item-1', true);
    await settle(4);

    expect(history.get()).toBe('/login?next=%2Fall%3Funread');
  });
});

describe('session guard sign in', () => {
  /** The first attempt fails with `InvalidCredentials`, the second one succeeds. */
  const respondFailedThenSignedIn = (): void => {
    let attempts = 0;
    respond((url) => {
      if (url.includes('/api/auth/session'))
        return json({ authenticated: false });
      if (!url.includes('/api/auth/login')) return undefined;

      attempts += 1;
      return attempts === 1
        ? json({ error: 'InvalidCredentials' }, 401)
        : new Response(null, { status: 204 });
    });
  };

  it('keeps ?next across a failed login and returns to quick save after success', async () => {
    respondFailedThenSignedIn();
    const next = '/save?url=https%3A%2F%2Fexample.com%2Fpost';
    const loginPath = `/login?next=${encodeURIComponent(next)}`;
    const { container, history } = mountApp(loginPath);
    await settle(4);
    expect(history.get()).toBe(loginPath);

    typeInto(container, 'input[type="password"]', 'wrong-password');
    submitForm(container);
    await settle(4);
    expect(container.textContent).toContain('密码不正确');
    expect(history.get()).toBe(loginPath);

    submitForm(container);
    await settle(4);
    expect(history.get()).toBe(next);
    expect(container.textContent).toContain('保存到稍后阅读');
    expect(must<HTMLInputElement>(container, 'input[type="url"]').value).toBe(
      'https://example.com/post'
    );
  });
});
describe('session guard login errors', () => {
  it('reports a rate-limited login inline', async () => {
    respond((url) => {
      if (url.includes('/api/auth/session'))
        return json({ authenticated: false });
      if (url.includes('/api/auth/login'))
        return json({ error: 'TooManyRequests' }, 429);

      return undefined;
    });

    const { container, history } = mountApp('/login');
    await settle(4);

    typeInto(container, 'input[type="password"]', 'secret');
    submitForm(container);
    await settle(4);

    expect(container.textContent).toContain('请求过于频繁，请稍后重试');
    expect(history.get()).toBe('/login');
  });

  it('requires a password before submitting', async () => {
    respond((url) =>
      url.includes('/api/auth/session')
        ? json({ authenticated: false })
        : undefined
    );

    const { container } = mountApp('/login');
    await settle(4);
    submitForm(container);
    await settle(4);

    expect(container.textContent).toContain('请输入密码。');
    expect(requestUrls().some((url) => url.includes('/api/auth/login'))).toBe(
      false
    );
  });
});

/** `LIB-RELOAD-1`: the first list page request for the active scope. */
const listPages = (): ReadonlyArray<string> =>
  requestUrls().filter((url) => url.startsWith('/api/feed-items?limit=30'));

describe('library layout', () => {
  it('renders the responsive three-panel layout and loads the route scope', async () => {
    const { container } = mountApp('/all/item-1');
    await settle(4);

    const grid = must(container, '.grid');
    expect(grid.className).toContain('md:grid-cols-[16rem_minmax(0,1fr)]');
    expect(grid.className).toContain(
      'xl:grid-cols-[16rem_24rem_minmax(0,1fr)]'
    );
    for (const panel of ['sidebar', 'list', 'reader']) {
      expect(container.querySelector(`[data-panel="${panel}"]`)).not.toBeNull();
    }
    const navToggle = must(container, '[aria-label="切换导航"]');
    expect(navToggle.closest('[data-panel="list"]')).not.toBeNull();
    expect(navToggle.className).toContain('md:hidden');
    expect(container.textContent).not.toContain('留白 / 全部订阅');

    const urls = requestUrls();
    expect(listPages()).toHaveLength(1);
    expect(urls.some((url) => url.startsWith('/api/feed-items/item-1'))).toBe(
      true
    );
    expect(urls).toContain('/api/feeds');
    expect(urls).toContain('/api/folders');
  });
});

describe('library panels', () => {
  it('hides the list panel in the single-panel reading view', async () => {
    const { container } = mountApp('/later/page-1');
    await settle(4);

    expect(must(container, '[data-panel="list"]').className).toContain(
      'hidden xl:flex'
    );
    expect(must(container, '[data-panel="reader"]').className).toContain(
      'flex'
    );
  });

  it('moves focus out of a panel that the route change hid', async () => {
    const { container, history } = mountApp('/all');
    await settle(4);

    const listPanel = must<HTMLElement>(container, '[data-panel="list"]');
    const readerPanel = must<HTMLElement>(container, '[data-panel="reader"]');
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
    const { history } = mountApp('/all');
    await settle(4);
    const before = listPages().length;

    history.set({ value: '/all/item-1' });
    await settle(4);

    expect(listPages()).toHaveLength(before);
  });

  it('does not auto-paginate when the list has no measurable layout', async () => {
    const item = {
      id: 'item-1',
      feedId: 'feed-1',
      url: 'https://example.com/item-1',
      title: 'Item 1',
      description: 'Summary',
      content: '<p>Body</p>',
      read: false,
    };
    respond((url) =>
      url.startsWith('/api/feed-items?limit=30')
        ? json({ items: [item], cursor: 'item-1' })
        : undefined
    );

    mountApp('/all');
    await settle(4);

    expect(listPages()).toHaveLength(1);
  });
});
