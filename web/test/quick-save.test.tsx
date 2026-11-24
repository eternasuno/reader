import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FetchHandler = (url: string, init: RequestInit) => Response | undefined;

const load = async () => {
  vi.resetModules();
  return {
    solid: await import('solid-js'),
    web: await import('@solidjs/web'),
    router: await import('@solidjs/router'),
    i18n: await import('../src/i18n'),
    routes: await import('../src/routes'),
    app: await import('../src/App'),
  };
};

type Harness = Awaited<ReturnType<typeof load>>;

let h: Harness;
let fetchMock: ReturnType<typeof vi.fn>;
const disposers: Array<() => void> = [];

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const respond = (handler: FetchHandler = () => undefined): void => {
  fetchMock.mockImplementation((input: unknown, init: unknown) => {
    const url = String(input);
    const custom = handler(url, (init ?? {}) as RequestInit);
    if (custom !== undefined) return Promise.resolve(custom);
    if (url.includes('/api/auth/session')) {
      return Promise.resolve(json({ authenticated: true }));
    }
    return Promise.resolve(json({ items: [], cursor: null, item: null }));
  });
};

const settle = async (times = 4): Promise<void> => {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.solid.flush();
  }
};

const mountApp = (path: string) => {
  for (const dispose of disposers.splice(0)) dispose();
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

const setField = (root: ParentNode, selector: string, value: string): void => {
  const el = root.querySelector<HTMLInputElement>(selector);
  if (el === null) throw new Error(`missing ${selector}`);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  h.solid.flush();
};

const submitForm = (root: ParentNode): void => {
  const form = root.querySelector<HTMLFormElement>('form');
  if (form === null) throw new Error('missing form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  h.solid.flush();
};

const savedPage = () => ({
  id: 'page-1',
  url: 'https://example.com/post',
  title: 'Post',
  content: 'Body',
  read: false,
});

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  respond();
  h = await load();
  h.i18n.setLocale('zh-CN');
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('settings bookmarklet', () => {
  it('uses #url= fragment instead of ?url= query parameter', async () => {
    respond((u) => {
      if (u === '/api/settings') {
        return json({
          retention: 50,
          provider: 'direct',
          jinaKeyConfigured: false,
          browserEndpointConfigured: false,
        });
      }
      if (u.includes('sends')) return json({ running: false, items: [] });
      return undefined;
    });
    const { container } = mountApp('/settings');
    await settle();
    const link = container.querySelector<HTMLAnchorElement>(
      'section[aria-label="文章与订阅"] a[draggable="true"]'
    );
    expect(link?.href).toContain('/save#url=');
    expect(link?.href).not.toContain('/save?url=');
  });
});

describe('legacy ?url= quick-save links', () => {
  it('consumes ?url= into memory, strips it from the address bar, and posts on confirm', async () => {
    respond((url, init) =>
      url === '/api/saved-pages' && init.method === 'POST'
        ? json({ item: savedPage() }, 201)
        : undefined
    );

    const { container, history } = mountApp(
      '/save?url=https%3A%2F%2Fexample.com%2Fpost'
    );
    await settle();

    expect(history.get()).toBe('/save');
    expect(
      container.querySelector<HTMLInputElement>('input[type="url"]')?.value
    ).toBe('https://example.com/post');
    expect(
      fetchMock.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === 'POST'
      )
    ).toHaveLength(0);

    submitForm(container);
    await settle();
    expect(history.get()).toBe('/later/page-1');
  });
});

describe('legacy ?url= login redirect', () => {
  it('strips legacy ?url= before redirecting unauthenticated visitors to /login', async () => {
    respond((url) =>
      url.includes('/api/auth/session')
        ? json({ authenticated: false })
        : undefined
    );

    const { history } = mountApp(
      '/save?url=https%3A%2F%2Fexample.com%2Flegacy%3Ftoken%3D1'
    );
    await settle();

    expect(history.get()).toBe('/login?next=%2Fsave');
  });
});

describe('QuickSavePage 401 expiry recovery', () => {
  it('keeps edited draft in memory across 401 -> /login -> /save without leaking URL in ?next', async () => {
    let signedIn = true;
    respond((url, init) => {
      if (url.includes('/api/auth/session'))
        return json({ authenticated: signedIn });
      if (url === '/api/auth/login') {
        signedIn = true;
        return new Response(null, { status: 204 });
      }
      if (url === '/api/saved-pages' && init.method === 'POST') {
        return json({ error: 'Unauthorized' }, 401);
      }
      return undefined;
    });

    const { container, history } = mountApp(
      '/save#url=https%3A%2F%2Fexample.com%2Fsecret%3Ftoken%3Dabc'
    );
    await settle();
    expect(history.get()).toBe('/save');

    setField(
      container,
      'input[type="url"]',
      'https://example.com/edited?token=xyz'
    );
    signedIn = false;
    submitForm(container);
    await settle();
    expect(history.get()).toBe('/login?next=%2Fsave');

    setField(container, 'input[type="password"]', 'secret');
    submitForm(container);
    await settle();
    expect(history.get()).toBe('/save');
    expect(
      container.querySelector<HTMLInputElement>('input[type="url"]')?.value
    ).toBe('https://example.com/edited?token=xyz');
  });
});

describe('quick save errors and cancel cleanup', () => {
  it('shows a translated error inline so the URL can be fixed', async () => {
    respond((url, init) =>
      url === '/api/saved-pages' && init.method === 'POST'
        ? json({ error: 'InvalidPageUrl' }, 400)
        : undefined
    );

    const { container, history } = mountApp('/save#url=not-a-url');
    await settle();
    expect(history.get()).toBe('/save');

    setField(container, 'input[type="url"]', 'ftp://example.com/post');
    submitForm(container);
    await settle();

    expect(container.textContent).toContain('请输入有效的 http 或 https 链接');
    expect(history.get()).toBe('/save');
  });

  it('clears the in-memory draft when leaving /save while authenticated', async () => {
    const { container, history } = mountApp(
      '/save#url=https%3A%2F%2Fexample.com%2Fsecret'
    );
    await settle();
    expect(history.get()).toBe('/save');

    container.querySelector<HTMLAnchorElement>('a[href="/later"]')?.click();
    await settle();
    expect(history.get()).toBe('/later');

    history.set({ value: '/save' });
    await settle();
    expect(
      container.querySelector<HTMLInputElement>('input[type="url"]')?.value
    ).toBe('');
  });
});
