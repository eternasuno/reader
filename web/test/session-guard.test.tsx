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
let disposers: Array<() => void> = [];

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

const settle = async (times = 3): Promise<void> => {
  for (let i = 0; i < times; i += 1) {
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
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('SessionGuard cross-tab revalidation', () => {
  it('validates session on protected route entry before revealing contents', async () => {
    let authenticated = true;
    respond((url) =>
      url.includes('/api/auth/session') ? json({ authenticated }) : undefined
    );

    const { history } = mountApp('/later');
    await settle(4);
    expect(history.get()).toBe('/later');

    authenticated = false;
    history.set({ value: '/settings?tab=services' });
    h.solid.flush();
    await settle(4);

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).not.toContain('/api/settings');
    expect(history.get()).toBe(
      `/login?next=${encodeURIComponent('/settings?tab=services')}`
    );
  });
});

describe('QuickSavePage missing conflict id', () => {
  it('shows inline error without lookup when 409 omits id', async () => {
    const savePath = '/save?url=https%3A%2F%2Fexample.com%2Fpost';
    respond((url, init) =>
      url === '/api/saved-pages' && init.method === 'POST'
        ? json({ error: 'SavedPageAlreadyExists' }, 409)
        : undefined
    );

    const { container, history } = mountApp(savePath);
    await settle(4);
    const form = container.querySelector('form');
    form?.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true })
    );
    h.solid.flush();
    await settle(4);

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((u) => u.startsWith('/api/saved-pages/lookup'))).toBe(
      false
    );
    expect(container.textContent).toContain('该文章已在稍后阅读中');
    expect(history.get()).toBe(savePath);
  });
});

describe('SessionGuard offline navigation', () => {
  it('shows a retryable error instead of redirecting on transport failure', async () => {
    let offline = true;
    fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes('/api/auth/session')) {
        return offline
          ? Promise.reject(new TypeError('offline'))
          : Promise.resolve(json({ authenticated: true }));
      }
      return Promise.resolve(json({ items: [], cursor: null, item: null }));
    });

    const { container, history } = mountApp('/later');
    await settle(4);

    expect(history.get()).toBe('/later');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '网络连接失败'
    );
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.every((u) => u.includes('/api/auth/session'))).toBe(true);

    offline = false;
    const retryBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('重试')
    );
    retryBtn?.click();
    await settle(4);

    expect(history.get()).toBe('/later');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    const afterRetry = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(afterRetry.some((u) => u.startsWith('/api/saved-pages'))).toBe(true);
  });
});
