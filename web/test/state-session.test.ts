import { beforeEach, describe, expect, it, vi } from 'vitest';

type StateModule = typeof import('../src/state');
type ApiModule = typeof import('../src/api');

let state: StateModule;
let solid: typeof import('solid-js');
let api: ApiModule;
let fetchMock: ReturnType<typeof vi.fn>;

const fresh = async (): Promise<void> => {
  vi.resetModules();
  solid = await import('solid-js');
  api = await import('../src/api');
  state = await import('../src/state');
};

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  await fresh();
});
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const noContent = (): Response => new Response(null, { status: 204 });

const queue = (body: unknown, status = 200): void => {
  fetchMock.mockResolvedValueOnce(json(body, status));
};

const queueEmpty = (): void => {
  fetchMock.mockResolvedValueOnce(noContent());
};
const requestUrl = (call = 0): string =>
  String(fetchMock.mock.calls[call]?.[0]);

const requestInit = (call = 0): RequestInit =>
  (fetchMock.mock.calls[call]?.[1] ?? {}) as RequestInit;

describe('session checks', () => {
  it('checks an authenticated session', async () => {
    queue({ authenticated: true });

    await expect(state.checkSession()).resolves.toBe(true);
    solid.flush();
    expect(state.sessionStatus()).toBe('authenticated');
    expect(requestUrl()).toBe('/api/auth/session');
  });

  it('checks an unauthenticated session and survives request failures', async () => {
    queue({ authenticated: false });
    await expect(state.checkSession()).resolves.toBe(false);
    solid.flush();
    expect(state.sessionStatus()).toBe('unauthenticated');

    state.markAuthenticated();
    solid.flush();
    queue({ error: 'RequestFailed' }, 500);
    await expect(state.checkSession()).resolves.toBe(false);
    solid.flush();
    expect(state.sessionStatus()).toBe('unauthenticated');
  });
});

describe('session teardown', () => {
  it('signs out and clears local session state', async () => {
    state.markAuthenticated();
    solid.flush();
    queueEmpty();

    await state.signOut();
    solid.flush();

    expect(requestUrl()).toBe('/api/auth/logout');
    expect(requestInit().method).toBe('POST');
    expect(state.sessionStatus()).toBe('unauthenticated');
  });

  it('flips to unauthenticated on any non-login 401', async () => {
    state.markAuthenticated();
    solid.flush();

    queue({ error: 'Unauthorized' }, 401);
    await expect(api.feedsApi.list()).rejects.toMatchObject({
      code: 'Unauthorized',
    });
    solid.flush();

    expect(state.sessionStatus()).toBe('unauthenticated');
  });
});
