import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/api';

type StateModule = typeof import('../src/state');
type I18nModule = typeof import('../src/i18n');
type UiModule = typeof import('../src/ui');

let state: StateModule;
let solid: typeof import('solid-js');
let i18n: I18nModule;
let ui: UiModule;
let fetchMock: ReturnType<typeof vi.fn>;
let disposeDrafts: (() => void) | undefined;

const fresh = async (): Promise<void> => {
  disposeDrafts?.();
  vi.resetModules();
  solid = await import('solid-js');
  i18n = await import('../src/i18n');
  ui = await import('../src/ui');
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
  provider: 'direct',
  jinaKeyConfigured: false,
  browserEndpointConfigured: false,
  ...overrides,
});

const load = async (loaded: Settings = makeSettings()): Promise<void> => {
  queue(loaded);
  queue({ running: false, items: [] });
  await state.loadSettings();
  solid.flush();
};

describe('retention save', () => {
  it('saves retention and clears the dirty state', async () => {
    await load();
    state.setRetentionDraft(50);
    solid.flush();

    queueEmpty();
    await expect(state.saveRetention()).resolves.toBe(true);
    solid.flush();

    expect(requestUrl(2)).toBe('/api/settings/retention');
    expect(requestInit(2).method).toBe('PUT');
    expect(requestBody(2)).toEqual({ retention: 50 });
    expect(state.settings()?.retention).toBe(50);
    expect(state.isSectionDirty('articles')).toBe(false);
    expect(state.isSaving()).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('settings.retentionSavedToast'))
    );
  });
});

describe('retention failure', () => {
  it('reports retention save failures', async () => {
    await load();
    state.setRetentionDraft(0);
    solid.flush();

    queue({ error: 'InvalidRetention' }, 400);
    await expect(state.saveRetention()).resolves.toBe(false);
    solid.flush();

    expect(state.settings()?.retention).toBe(100);
    expect(state.isSaving()).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('InvalidRetention')
    );
  });
});

describe('provider save', () => {
  it('saves each extraction provider via /api/settings/provider', async () => {
    await load(makeSettings({ browserEndpointConfigured: true }));

    queueEmpty();
    await expect(state.saveProvider()).resolves.toBe(true);
    expect(requestUrl(2)).toBe('/api/settings/provider');
    expect(requestInit(2).method).toBe('PUT');
    expect(requestBody(2)).toEqual({ provider: 'direct' });

    state.setProviderDraft('jina');
    solid.flush();
    queueEmpty();
    await expect(state.saveProvider()).resolves.toBe(true);
    expect(requestUrl(3)).toBe('/api/settings/provider');
    expect(requestBody(3)).toEqual({ provider: 'jina' });
    expect(state.settings()?.provider).toBe('jina');
    expect(state.isSectionDirty('extraction')).toBe(false);

    state.setProviderDraft('browser');
    solid.flush();
    queueEmpty();
    await expect(state.saveProvider()).resolves.toBe(true);
    expect(requestUrl(4)).toBe('/api/settings/provider');
    expect(requestBody(4)).toEqual({ provider: 'browser' });
    expect(state.settings()?.provider).toBe('browser');
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('settings.extractionSavedToast'))
    );
  });

  it('reports missing browser endpoint when saving browser provider', async () => {
    await load();
    state.setProviderDraft('browser');
    solid.flush();

    queue({ error: 'BrowserEndpointRequired' }, 422);
    await expect(state.saveProvider()).resolves.toBe(false);
    solid.flush();

    expect(state.settings()?.provider).toBe('direct');
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('BrowserEndpointRequired')
    );
  });
});

describe('save lock ownership across sessions', () => {
  it('prevents an old in-flight save from releasing a newer session lock', async () => {
    state.markAuthenticated();
    await load();
    state.setRetentionDraft(50);
    solid.flush();

    let resolveOld: (res: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (resolveOld = resolve))
    );
    const oldSave = state.saveRetention();
    solid.flush();
    expect(state.savingAction()).toBe('retention');

    state.markUnauthenticated();
    state.markAuthenticated();
    disposeDrafts = state.mountSettingsDrafts();
    await load();
    state.setProviderDraft('jina');
    solid.flush();

    let resolveNew: (res: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>((resolve) => (resolveNew = resolve))
    );
    const newSave = state.saveProvider();
    solid.flush();
    expect(state.savingAction()).toBe('provider');

    resolveOld(noContent());
    await expect(oldSave).resolves.toBe(false);
    solid.flush();
    expect(state.isSaving()).toBe(true);
    expect(state.savingAction()).toBe('provider');
    expect(state.settings()?.retention).toBe(100);

    resolveNew(noContent());
    await expect(newSave).resolves.toBe(true);
    solid.flush();
    expect(state.isSaving()).toBe(false);
    expect(state.savingAction()).toBeNull();
  });
});
