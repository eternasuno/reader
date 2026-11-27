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

  it('clears session only on false or 401', async () => {
    const cleared = vi.fn();
    const unsub = state.onSessionCleared(cleared);

    queue({ authenticated: false });
    await expect(state.checkSession()).resolves.toBe(false);
    expect(state.sessionStatus()).toBe('unauthenticated');
    expect(cleared).toHaveBeenCalledTimes(1);

    state.markAuthenticated();
    queue({ error: 'Unauthorized' }, 401);
    await expect(state.checkSession()).resolves.toBe(false);
    expect(state.sessionStatus()).toBe('unauthenticated');
    expect(cleared).toHaveBeenCalledTimes(2);
    unsub();
  });

  it('coalesces concurrent checkSession calls into one in-flight request', async () => {
    let resolveSession: (res: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveSession = resolve;
        })
    );

    const first = state.checkSession();
    const second = state.checkSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveSession(json({ authenticated: true }));
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    solid.flush();
    expect(state.sessionStatus()).toBe('authenticated');
  });
});

describe('session probe error handling', () => {
  it('moves to error without clearing session on 500 or NetworkError and recovers on retry', async () => {
    const cleared = vi.fn();
    const unsub = state.onSessionCleared(cleared);
    state.markAuthenticated();

    queue({ error: 'RequestFailed' }, 500);
    await expect(state.checkSession()).resolves.toBe(false);
    expect(state.sessionStatus()).toBe('error');
    expect(state.sessionErrorCode()).toBe('RequestFailed');
    expect(cleared).not.toHaveBeenCalled();

    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await expect(state.checkSession()).resolves.toBe(false);
    expect(state.sessionStatus()).toBe('error');
    expect(state.sessionErrorCode()).toBe('NetworkError');
    expect(cleared).not.toHaveBeenCalled();

    queue({ authenticated: true });
    await expect(state.checkSession()).resolves.toBe(true);
    expect(state.sessionStatus()).toBe('authenticated');
    expect(state.sessionErrorCode()).toBeNull();
    unsub();
  });
});

const seedSettings = async (): Promise<void> => {
  queue({ retention: 50 });
  queue({ running: true, items: [] });
  await state.loadSettings();
  solid.flush();
};

describe('session signOut', () => {
  it('signs out and clears local session state', async () => {
    const cleared = vi.fn();
    const unsub = state.onSessionCleared(cleared);
    state.markAuthenticated();
    await seedSettings();
    expect(state.settings()).not.toBeNull();
    expect(state.kindleRunning()).toBe(true);

    queueEmpty();
    await state.signOut();
    solid.flush();

    expect(requestUrl(2)).toBe('/api/auth/logout');
    expect(requestInit(2).method).toBe('POST');
    expect(state.sessionStatus()).toBe('unauthenticated');
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(state.settings()).toBeNull();
    expect(state.kindleRunning()).toBe(false);
    unsub();
  });
});

describe('session 401 handling', () => {
  it('flips to unauthenticated and clears session state on any non-login 401', async () => {
    const cleared = vi.fn();
    const unsub = state.onSessionCleared(cleared);
    state.markAuthenticated();
    await seedSettings();

    queue({ error: 'Unauthorized' }, 401);
    await expect(api.feedsApi.list()).rejects.toMatchObject({
      code: 'Unauthorized',
    });
    solid.flush();

    expect(state.sessionStatus()).toBe('unauthenticated');
    expect(cleared).toHaveBeenCalledTimes(1);
    expect(state.settings()).toBeNull();
    unsub();
  });

  it('ignores a delayed 401 from an obsolete auth generation after re-login', async () => {
    state.markAuthenticated();
    let resolveStale: (res: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveStale = resolve;
        })
    );
    const staleRequest = api.feedsApi.list();

    state.markUnauthenticated();
    state.markAuthenticated();
    await seedSettings();

    const cleared = vi.fn();
    const unsub = state.onSessionCleared(cleared);
    resolveStale(json({ error: 'Unauthorized' }, 401));
    await expect(staleRequest).rejects.toMatchObject({ code: 'Unauthorized' });
    solid.flush();

    expect(state.sessionStatus()).toBe('authenticated');
    expect(state.settings()).not.toBeNull();
    expect(cleared).not.toHaveBeenCalled();
    unsub();
  });
});
