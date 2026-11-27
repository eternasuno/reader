import { describe, expect, it } from 'vitest';
import { createAppHarness, json } from './support/app-harness';

const harness = createAppHarness({ settleTimes: 3 });
const { respond, settle, mountApp: mount } = harness;
harness.installHarnessLifecycle();
const mountApp = mount;

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
    harness.modules.solid.flush();
    await settle(4);

    const urls = harness.fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls).not.toContain('/api/settings');
    expect(history.get()).toBe(
      `/login?next=${encodeURIComponent('/settings?tab=services')}`
    );
  });
});

describe('SessionGuard offline navigation', () => {
  it('shows a retryable error instead of redirecting on transport failure', async () => {
    let offline = true;
    harness.fetchMock.mockImplementation((input: unknown) => {
      const url = String(input);
      if (url.includes('/api/auth/session')) {
        return offline
          ? Promise.reject(new TypeError('offline'))
          : Promise.resolve(json({ authenticated: true }));
      }
      return Promise.resolve(
        json({
          items: [],
          count: 0,
          ids: [],
          boundary: '019363b8-0000-7000-8000-000000000000',
          item: null,
        })
      );
    });

    const { container, history } = mountApp('/later');
    await settle(4);

    expect(history.get()).toBe('/later');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '网络连接失败'
    );
    const urls = harness.fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.every((u) => u.includes('/api/auth/session'))).toBe(true);

    offline = false;
    const retryBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('重试')
    );
    retryBtn?.click();
    await settle(4);

    expect(history.get()).toBe('/later');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    const afterRetry = harness.fetchMock.mock.calls.map((call) =>
      String(call[0])
    );
    expect(afterRetry.some((u) => u.startsWith('/api/saved-pages'))).toBe(true);
  });
});

describe('LoginPage authenticated redirect', () => {
  it('redirects an already signed-in visitor on /login to sanitized ?next', async () => {
    const { history } = mountApp('/login?next=%2Fall%3Funread');
    await settle(4);

    expect(history.get()).toBe('/all?unread');
  });
});
