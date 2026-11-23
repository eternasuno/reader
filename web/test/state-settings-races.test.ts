import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/api';

type StateModule = typeof import('../src/state');

let state: StateModule;
let solid: typeof import('solid-js');
let fetchMock: ReturnType<typeof vi.fn>;
let disposeDrafts: (() => void) | undefined;

const fresh = async (): Promise<void> => {
  disposeDrafts?.();
  vi.resetModules();
  solid = await import('solid-js');
  state = await import('../src/state');
  disposeDrafts = state.mountSettingsDrafts();
};

afterEach(() => {
  disposeDrafts?.();
  disposeDrafts = undefined;
});

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

const pending = (): { resolve: (response: Response) => void } => {
  let resolveFn: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolveFn = resolve;
  });
  fetchMock.mockImplementationOnce(() => promise);
  return { resolve: resolveFn };
};

const makeSettings = (overrides: Partial<Settings> = {}): Settings => ({
  retention: 100,
  provider: 'direct',
  jinaKeyConfigured: false,
  browserEndpointConfigured: false,
  ...overrides,
});

describe('stale settings GET after remount', () => {
  it('ignores an earlier visit GET resolving after remount and edits', async () => {
    state.markAuthenticated();
    const visit1Get = pending();
    const firstLoad = state.loadSettings();

    disposeDrafts?.();
    disposeDrafts = state.mountSettingsDrafts();
    fetchMock.mockResolvedValueOnce(json(makeSettings({ retention: 100 })));
    fetchMock.mockResolvedValueOnce(json({ running: false, items: [] }));
    await state.loadSettings();
    solid.flush();

    state.setRetentionDraft(42);
    state.setJinaKeyDraft('new-secret');
    state.setSmtpPasswordDraft('smtp-secret');
    solid.flush();

    const callsBeforeStale = fetchMock.mock.calls.length;
    visit1Get.resolve(json(makeSettings({ retention: 25 })));
    await firstLoad;
    solid.flush();

    expect(state.settings()?.retention).toBe(100);
    expect(state.retentionDraft()).toBe(42);
    expect(state.jinaKeyDraft()).toBe('new-secret');
    expect(state.smtpPasswordDraft()).toBe('smtp-secret');
    expect(fetchMock.mock.calls.length).toBe(callsBeforeStale);
  });
});

const sendsPayload = (id: string) =>
  json({
    running: true,
    items: [
      {
        id,
        trigger: 'manual',
        status: 'running',
        articleCount: 0,
        bookCount: 0,
        startedAt: '2026-11-20T08:00:00Z',
      },
    ],
  });

describe('delayed Kindle history after logout', () => {
  it('ignores loadSettings sends resolving after markUnauthenticated', async () => {
    state.markAuthenticated();
    fetchMock.mockResolvedValueOnce(json(makeSettings()));
    const sendsSlot = pending();
    const loading = state.loadSettings();
    await Promise.resolve();
    await Promise.resolve();

    state.markUnauthenticated();
    state.markAuthenticated();
    sendsSlot.resolve(sendsPayload('s1'));
    await loading;
    solid.flush();

    expect(state.kindleSends()).toEqual([]);
    expect(state.kindleRunning()).toBe(false);
  });

  it('ignores refreshKindleSends resolving after markUnauthenticated', async () => {
    state.markAuthenticated();
    const sendsSlot = pending();
    const refreshing = state.refreshKindleSends();

    state.markUnauthenticated();
    state.markAuthenticated();
    sendsSlot.resolve(sendsPayload('s2'));
    await refreshing;
    solid.flush();

    expect(state.kindleSends()).toEqual([]);
    expect(state.kindleRunning()).toBe(false);
  });
});
