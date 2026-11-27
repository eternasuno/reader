import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/api';
import type { SettingsDrafts } from '../src/state';

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

const makeSettings = (overrides: Partial<Settings> = {}): Settings => ({
  retention: 100,
  ...overrides,
});

const load = async (loaded: Settings = makeSettings()): Promise<void> => {
  queue(loaded);
  queue({ running: false, items: [] });
  await state.loadSettings((next) => {
    setDrafts(() => state.draftsFromSettings(next));
  });
  solid.flush();
};

describe('retention save', () => {
  it('saves retention and clears the dirty state', async () => {
    await load();
    setDrafts((d) => ({ ...d, retention: '50' }));
    solid.flush();

    queueEmpty();
    await expect(state.saveRetention(drafts)).resolves.toBe(true);
    solid.flush();

    expect(requestUrl(2)).toBe('/api/settings/retention');
    expect(requestInit(2).method).toBe('PUT');
    expect(requestBody(2)).toEqual({ retention: 50 });
    expect(state.settings()?.retention).toBe(50);
    expect(state.isSectionDirty('articles', drafts)).toBe(false);
    expect(state.isSaving()).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('settings.retentionSavedToast'))
    );
  });
});

describe('retention failure', () => {
  it('rejects an invalid draft before sending a request', async () => {
    await load();
    setDrafts((d) => ({ ...d, retention: '1e3' }));
    solid.flush();

    const requestsBeforeSave = fetchMock.mock.calls.length;
    await expect(state.saveRetention(drafts)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(requestsBeforeSave);
    expect(state.settings()?.retention).toBe(100);
  });

  it('reports retention save failures', async () => {
    await load();
    setDrafts((d) => ({ ...d, retention: '50' }));
    solid.flush();

    queue({ error: 'FeedItemBudgetExceeded' }, 400);
    await expect(state.saveRetention(drafts)).resolves.toBe(false);
    solid.flush();

    expect(state.settings()?.retention).toBe(100);
    expect(state.isSaving()).toBe(false);
    expect(requestUrl(2)).toBe('/api/settings/retention');
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('FeedItemBudgetExceeded')
    );
  });
});

describe('Browserless save failure', () => {
  it('reports an invalid Browserless URL and keeps the saved settings', async () => {
    await load();
    setDrafts((d) => ({ ...d, browserlessUrl: 'ftp://invalid.example.com' }));
    solid.flush();

    queue({ error: 'InvalidBrowserlessSetting' }, 400);
    await expect(state.saveBrowserless(drafts, setDrafts)).resolves.toBe(false);
    solid.flush();

    expect(requestUrl(2)).toBe('/api/settings/services/browserless');
    expect(requestInit(2).method).toBe('PUT');
    expect(state.settings()?.browserless).toBeUndefined();
    expect(drafts.browserlessUrl).toBe('ftp://invalid.example.com');
    expect(state.isSaving()).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('InvalidBrowserlessSetting')
    );
  });
});

describe('save lock ownership across sessions', () => {
  it('prevents an old in-flight save from releasing a newer session lock', async () => {
    state.markAuthenticated();
    await load();
    setDrafts((d) => ({ ...d, retention: '50' }));
    solid.flush();

    let resolveOld: (res: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (resolveOld = resolve))
    );
    const oldSave = state.saveRetention(drafts);
    solid.flush();
    expect(state.savingAction()).toBe('retention');

    state.markUnauthenticated();
    state.markAuthenticated();
    await load();
    setDrafts((d) => ({
      ...d,
      browserlessUrl: 'https://browserless.example.com',
    }));
    solid.flush();

    let resolveNew: (res: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (resolveNew = resolve))
    );
    const newSave = state.saveBrowserless(drafts, setDrafts);
    solid.flush();
    expect(state.savingAction()).toBe('browserless');

    resolveOld(noContent());
    await expect(oldSave).resolves.toBe(false);
    solid.flush();
    expect(state.isSaving()).toBe(true);
    expect(state.savingAction()).toBe('browserless');
    expect(state.settings()?.retention).toBe(100);

    resolveNew(noContent());
    await expect(newSave).resolves.toBe(true);
    solid.flush();
    expect(state.isSaving()).toBe(false);
    expect(state.savingAction()).toBeNull();
  });
});
