import { describe, expect, it } from 'vitest';
import { createAppHarness, json } from './support/app-harness';

const SAVE_PATH = '/save#url=https%3A%2F%2Fexample.com%2Fpost';
const harness = createAppHarness({ settleTimes: 4 });
const { respond, settle, mountApp: mount } = harness;
harness.installHarnessLifecycle();
const mountApp = mount;

const setField = (root: ParentNode, selector: string, value: string): void => {
  const el = root.querySelector<HTMLInputElement>(selector);
  if (el === null) throw new Error(`missing ${selector}`);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  harness.modules.solid.flush();
};

const submitForm = (root: ParentNode): void => {
  const form = root.querySelector<HTMLFormElement>('form');
  if (form === null) throw new Error('missing form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  harness.modules.solid.flush();
};

const savedPage = () => ({
  id: 'page-1',
  url: 'https://example.com/post',
  title: 'Post',
  content: 'Body',
  read: false,
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
      harness.fetchMock.mock.calls.filter(
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

const requestUrls = (): Array<string> =>
  harness.fetchMock.mock.calls.map((call) => String(call[0]));

const hasUrl = (prefix: string): boolean =>
  requestUrls().some((url) => url.startsWith(prefix));

/** `later.md:54-58`: the confirmation form performs exactly one mutating request. */
const posts = (): ReadonlyArray<unknown> =>
  harness.fetchMock.mock.calls.filter(
    (call) => (call[1] as RequestInit | undefined)?.method === 'POST'
  );

const must = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`missing ${selector}`);

  return found;
};

const inputValue = (root: ParentNode, selector: string): string =>
  must<HTMLInputElement>(root, selector).value;

const submitFragmentForm = (root: ParentNode): void => {
  const form = must<HTMLFormElement>(root, 'form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  harness.modules.solid.flush();
};

describe('quick save page', () => {
  it('never mutates on GET and posts once from the focused form', async () => {
    respond((url, init) =>
      url === '/api/saved-pages' && init.method === 'POST'
        ? json({ item: savedPage() }, 201)
        : undefined
    );

    const { container, history } = mountApp(SAVE_PATH);
    await settle(4);

    expect(posts()).toHaveLength(0);
    expect(history.get()).toBe('/save');
    expect(inputValue(container, 'input[type="url"]')).toBe(
      'https://example.com/post'
    );
    expect(document.activeElement).toBe(
      must(container, 'button[type="submit"]')
    );

    submitFragmentForm(container);
    await settle(4);

    expect(posts()).toHaveLength(1);
    expect(history.get()).toBe('/later/page-1');
  });

  it('opens the existing page by conflict id when the URL is already saved', async () => {
    respond((url, init) => {
      if (url === '/api/saved-pages' && init.method === 'POST')
        return json({ error: 'SavedPageAlreadyExists', id: 'page-1' }, 409);
      if (url === '/api/saved-pages/page-1' && (init.method ?? 'GET') === 'GET')
        return json({ item: savedPage() });

      return undefined;
    });

    const { container, history } = mountApp(SAVE_PATH);
    await settle(4);
    submitFragmentForm(container);
    await settle(4);

    expect(hasUrl('/api/saved-pages/page-1')).toBe(true);
    expect(history.get()).toBe('/later/page-1');
    expect(harness.modules.ui.currentToast()).toBeNull();
  });
});

describe('QuickSavePage missing conflict id', () => {
  it('shows inline error without lookup when 409 omits id', async () => {
    const savePath = '/save#url=https%3A%2F%2Fexample.com%2Fpost';
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
    harness.modules.solid.flush();
    await settle(4);

    expect(container.textContent).toContain('该文章已在稍后阅读中');
    expect(history.get()).toBe('/save');
  });
});
