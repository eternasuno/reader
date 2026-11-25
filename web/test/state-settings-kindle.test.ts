import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/api';
import type { SettingsDrafts } from '../src/state';
import { makeKindleSettings as makeSettings } from './support/state-fixture';

type StateModule = typeof import('../src/state');
type I18nModule = typeof import('../src/i18n');
type UiModule = typeof import('../src/ui');
type StoreSetter = import('solid-js').StoreSetter<SettingsDrafts>;

let state: StateModule;
let solid: typeof import('solid-js');
let i18n: I18nModule;
let ui: UiModule;
let fetchMock: ReturnType<typeof vi.fn>;
let drafts: SettingsDrafts;
let setDrafts: StoreSetter;
let disposeRoot: (() => void) | undefined;

const fresh = async (): Promise<void> => {
  disposeRoot?.();
  vi.resetModules();
  solid = await import('solid-js');
  i18n = await import('../src/i18n');
  ui = await import('../src/ui');
  state = await import('../src/state');
  disposeRoot = solid.createRoot((dispose) => {
    const [store, setStore] = solid.createStore<SettingsDrafts>(
      state.draftsFromSettings(null)
    );
    drafts = store;
    setDrafts = setStore;
    return dispose;
  });
};

afterEach(() => {
  disposeRoot?.();
  disposeRoot = undefined;
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

const requestBody = (call = 0): unknown => {
  const body = requestInit(call).body;
  return typeof body === 'string' ? JSON.parse(body) : body;
};

const load = async (loaded: Settings = makeSettings()): Promise<void> => {
  queue(loaded);
  queue({ running: false, items: [] });
  await state.loadSettings((next) => {
    setDrafts(() => state.draftsFromSettings(next));
  });
  solid.flush();
};

describe('kindle save', () => {
  it('saves only kindleEmail and sendTime and clears dirty state', async () => {
    await load();
    setDrafts((d) => ({
      ...d,
      kindleEmail: ' new@kindle.com ',
      sendTime: '07:30',
    }));
    solid.flush();

    queueEmpty();
    queue(
      makeSettings({
        retention: 999,
        kindle: {
          kindleEmail: 'new@kindle.com',
          sendTime: '07:30',
          nextSendAt: '2026-11-21T07:30:00Z',
        },
      })
    );
    await expect(state.saveKindle(drafts, setDrafts)).resolves.toBe(true);
    solid.flush();

    expect(requestUrl(2)).toBe('/api/settings/kindle');
    expect(requestInit(2).method).toBe('PUT');
    expect(requestBody(2)).toEqual({
      kindleEmail: 'new@kindle.com',
      sendTime: '07:30',
    });
    expect(requestUrl(3)).toBe('/api/settings');
    expect(state.settings()?.retention).toBe(100);
    expect(state.settings()?.kindle).toEqual({
      kindleEmail: 'new@kindle.com',
      sendTime: '07:30',
      nextSendAt: '2026-11-21T07:30:00Z',
    });
    expect(drafts.kindleEmail).toBe('new@kindle.com');
    expect(state.isSectionDirty('kindle', drafts)).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('settings.kindleSavedToast'))
    );
  });
});

describe('kindle schedule disable', () => {
  it('omits blank sendTime when disabling scheduled sends', async () => {
    await load();
    setDrafts((d) => ({ ...d, sendTime: '   ' }));
    solid.flush();

    queueEmpty();
    queue(makeSettings({ kindle: { kindleEmail: 'kindle@example.com' } }));
    await expect(state.saveKindle(drafts, setDrafts)).resolves.toBe(true);
    solid.flush();

    const body = requestBody(2) as Record<string, unknown>;
    expect(body).toEqual({ kindleEmail: 'kindle@example.com' });
    expect('sendTime' in body).toBe(false);
    expect(state.settings()?.kindle).toEqual({
      kindleEmail: 'kindle@example.com',
    });
    expect(state.settings()?.kindle?.nextSendAt).toBeUndefined();
    expect(state.isSectionDirty('kindle', drafts)).toBe(false);
  });
});

describe('kindle save fallback', () => {
  it('falls back to submitted values and clears nextSendAt when re-read fails', async () => {
    await load();
    setDrafts((d) => ({
      ...d,
      kindleEmail: 'fallback@kindle.com',
      sendTime: '',
    }));
    solid.flush();

    queueEmpty();
    queue({ error: 'SettingRepositoryError' }, 500);
    await expect(state.saveKindle(drafts, setDrafts)).resolves.toBe(true);
    solid.flush();

    expect(state.settings()?.kindle).toEqual({
      kindleEmail: 'fallback@kindle.com',
    });
    expect(state.settings()?.kindle?.nextSendAt).toBeUndefined();
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('settings.kindleSavedToast'))
    );
  });
});

describe('kindle save failure', () => {
  it.each([
    {
      error: 'InvalidKindleSetting',
      status: 400,
      email: 'bad-email',
      initial: makeSettings(),
    },
    {
      error: 'SMTPNotConfigured',
      status: 422,
      email: 'a@kindle.com',
      initial: makeSettings({ smtp: undefined, kindle: undefined }),
    },
  ])(
    'reports $error and preserves saved settings',
    async ({ error, status, email, initial }) => {
      await load(initial);
      setDrafts((d) => ({ ...d, kindleEmail: email }));
      solid.flush();
      queue({ error }, status);

      await expect(state.saveKindle(drafts, setDrafts)).resolves.toBe(false);
      solid.flush();
      expect(state.settings()?.kindle).toEqual(initial.kindle);
      expect(ui.currentToast()?.message).toBe(i18n.translateErrorCode(error));
      expect(state.isSaving()).toBe(false);
    }
  );
});
