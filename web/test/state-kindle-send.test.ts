import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/api';
import { makeKindleSettings as makeSettings } from './support/state-fixture';

type StateModule = typeof import('../src/state');
type I18nModule = typeof import('../src/i18n');
type UiModule = typeof import('../src/ui');

let state: StateModule;
let solid: typeof import('solid-js');
let i18n: I18nModule;
let ui: UiModule;
let fetchMock: ReturnType<typeof vi.fn>;

const fresh = async (): Promise<void> => {
  vi.resetModules();
  solid = await import('solid-js');
  i18n = await import('../src/i18n');
  ui = await import('../src/ui');
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

const _queueEmpty = (): void => {
  fetchMock.mockResolvedValueOnce(noContent());
};
const requestUrl = (call = 0): string =>
  String(fetchMock.mock.calls[call]?.[0]);

const _requestInit = (call = 0): RequestInit =>
  (fetchMock.mock.calls[call]?.[1] ?? {}) as RequestInit;

const fetchCount = (): number => fetchMock.mock.calls.length;
const pending = (): { resolve: (response: Response) => void } => {
  let resolveFn: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolveFn = resolve;
  });
  fetchMock.mockImplementationOnce(() => promise);
  return { resolve: resolveFn };
};
const load = async (loaded: Settings = makeSettings()): Promise<void> => {
  queue(loaded);
  queue({ running: false, items: [] });
  await state.loadSettings();
  solid.flush();
};

describe('manual send', () => {
  it('queues a manual Kindle send and prepends it to the history', async () => {
    await load();
    const record = {
      id: 's1',
      trigger: 'manual' as const,
      status: 'running' as const,
      articleCount: 0,
      bookCount: 0,
      startedAt: '2026-11-19T08:00:00Z',
    };
    queue({ item: record });

    await expect(state.triggerKindleSend()).resolves.toBe(true);
    solid.flush();

    expect(requestUrl(2)).toBe('/api/kindle/send');
    expect(state.kindleSends().map((send) => send.id)).toEqual(['s1']);
    expect(state.kindleRunning()).toBe(true);
    expect(state.kindleSending()).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('kindle.queuedToast'))
    );
  });
});

describe('send conflict', () => {
  it('recovers the running state after a 409 send conflict', async () => {
    await load();
    const running = {
      id: 's1',
      trigger: 'scheduled' as const,
      status: 'running' as const,
      articleCount: 0,
      bookCount: 0,
      startedAt: '2026-11-19T08:00:00Z',
    };
    queue({ error: 'KindleSendInProgress' }, 409);
    queue({ running: true, items: [running] });

    await expect(state.triggerKindleSend()).resolves.toBe(false);
    solid.flush();

    expect(requestUrl(3)).toBe('/api/kindle/sends');
    expect(state.kindleRunning()).toBe(true);
    expect(state.kindleSends()).toHaveLength(1);
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('KindleSendInProgress')
    );
  });
});

describe('send guard', () => {
  it('does not queue a second send while one is in flight', async () => {
    await load();
    const slow = pending();
    const sending = state.triggerKindleSend();
    solid.flush();
    expect(state.kindleSending()).toBe(true);

    await expect(state.triggerKindleSend()).resolves.toBe(false);
    expect(fetchCount()).toBe(3);

    slow.resolve(
      json({
        item: {
          id: 's1',
          trigger: 'manual',
          status: 'running',
          articleCount: 0,
          bookCount: 0,
          startedAt: '2026-11-19T08:00:00Z',
        },
      })
    );
    await sending;
    solid.flush();
    expect(state.kindleSending()).toBe(false);
  });
});

describe('refreshKindleSends', () => {
  it('re-reads send history and running state, keeping snapshot on failure', async () => {
    await load();
    const done = {
      id: 's2',
      trigger: 'scheduled' as const,
      status: 'succeeded' as const,
      articleCount: 2,
      bookCount: 1,
      startedAt: '2026-11-20T08:00:00Z',
    };
    queue({ running: false, items: [done] });

    await state.refreshKindleSends();
    solid.flush();

    expect(requestUrl(2)).toBe('/api/kindle/sends');
    expect(state.kindleRunning()).toBe(false);
    expect(state.kindleSends().map((send) => send.id)).toEqual(['s2']);

    queue({ error: 'SettingRepositoryError' }, 500);
    await state.refreshKindleSends();
    solid.flush();
    expect(state.kindleSends().map((send) => send.id)).toEqual(['s2']);
  });
});
