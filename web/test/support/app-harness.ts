import { afterEach, beforeEach, vi } from 'vitest';

type FetchHandler = (
  url: string,
  init: RequestInit
) => Response | Promise<Response> | undefined;

const load = async () => {
  vi.resetModules();
  return {
    solid: await import('solid-js'),
    web: await import('@solidjs/web'),
    router: await import('@solidjs/router'),
    state: await import('../../src/state'),
    i18n: await import('../../src/i18n'),
    ui: await import('../../src/ui'),
    routes: await import('../../src/routes'),
    app: await import('../../src/App'),
  };
};

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const DEFAULT_BOUNDARY = '019363b8-0000-7000-8000-000000000000';

const NO_CONTENT_METHODS = new Set(['PATCH', 'PUT', 'DELETE']);

const readAllResponse = (init: RequestInit): Response => {
  if (typeof init.body !== 'string') {
    return json({ error: 'RequestFailed' }, 400);
  }
  try {
    const parsed = JSON.parse(init.body) as { before?: unknown };
    if (typeof parsed?.before === 'string' && parsed.before.length > 0) {
      return new Response(null, { status: 204 });
    }
  } catch {
    // Fall through to 400.
  }
  return json({ error: 'RequestFailed' }, 400);
};

const isReadAllRequest = (url: string, init: RequestInit): boolean =>
  (init.method ?? 'GET') === 'POST' && url.split('?')[0].endsWith('/read-all');

const defaultResponse = (url: string, init: RequestInit): Response => {
  if (isReadAllRequest(url, init)) return readAllResponse(init);
  return NO_CONTENT_METHODS.has(init.method ?? 'GET')
    ? new Response(null, { status: 204 })
    : json(defaultBody(url));
};

const defaultBody = (url: string): unknown => {
  if (url.includes('/api/auth/session')) return { authenticated: true };
  if (url.includes('/api/kindle/sends')) return { running: false, items: [] };
  if (url.includes('/api/saved-pages/unread-count')) {
    return { count: 0, boundary: DEFAULT_BOUNDARY };
  }
  if (url.includes('/api/feeds/unread-counts')) {
    return { items: [], boundary: DEFAULT_BOUNDARY };
  }
  if (url.includes('/api/settings')) return { retention: 100 };
  const path = url.split('?')[0];
  if (path === '/api/saved-pages/order')
    return { ids: [], boundary: DEFAULT_BOUNDARY };
  if (path.endsWith('/order'))
    return { groups: [], boundary: DEFAULT_BOUNDARY };
  return { items: [], item: null };
};

class AppHarness {
  modules!: Awaited<ReturnType<typeof load>>;
  fetchMock!: ReturnType<typeof vi.fn>;
  private readonly disposers: Array<() => void> = [];
  constructor(private readonly settleTimes: number) {}

  respond = (handler: FetchHandler = () => undefined): void => {
    this.fetchMock.mockImplementation((input: unknown, init: unknown) => {
      const url = String(input);
      const request = (init ?? {}) as RequestInit;

      return Promise.resolve(
        handler(url, request) ?? defaultResponse(url, request)
      );
    });
  };

  respondUnauthenticated = (): void => {
    this.respond((url) =>
      url.includes('/api/auth/session')
        ? json({ authenticated: false })
        : undefined
    );
  };

  settle = async (times = this.settleTimes): Promise<void> => {
    for (let i = 0; i < times; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      this.modules.solid.flush();
    }
  };

  mountApp = (path: string) => {
    const h = this.modules;
    const history = h.router.memoryHistory(path);
    const router = h.routes.createAppRouter(history);
    const container = document.createElement('div');
    document.body.append(container);
    this.disposers.push(
      h.web.render(
        () => h.solid.createComponent(h.app.App, { router }),
        container
      )
    );
    h.solid.flush();
    return { container, history };
  };

  installHarnessLifecycle = () => {
    beforeEach(async () => {
      this.fetchMock = vi.fn();
      vi.stubGlobal('fetch', this.fetchMock);
      vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
      localStorage.clear();
      this.respond();
      this.modules = await load();
      this.modules.i18n.setLocale('zh-CN');
    });
    afterEach(() => {
      for (const dispose of this.disposers.splice(0)) dispose();
      this.modules?.ui.dismissToast();
      document.body.innerHTML = '';
      vi.restoreAllMocks();
    });
  };
}

export const createAppHarness = ({ settleTimes = 3 } = {}) =>
  new AppHarness(settleTimes);
