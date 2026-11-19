import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/api';

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
  kindle: {
    kindleEmail: 'kindle@example.com',
    senderEmail: 'sender@example.com',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    smtpUser: 'smtp-user',
    sendTime: '08:00',
    nextSendAt: '2026-11-20T08:00:00Z',
    smtpPasswordConfigured: true,
  },
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

describe('extraction providers', () => {
  it('saves each extraction provider', async () => {
    await load();

    queueEmpty();
    await state.saveExtraction();
    expect(requestUrl(2)).toBe('/api/settings/fetcher/direct');

    state.setProviderDraft('jina');
    state.setJinaKeyDraft('jina-key');
    solid.flush();
    queueEmpty();
    await expect(state.saveExtraction()).resolves.toBe(true);
    expect(requestUrl(3)).toBe('/api/settings/fetcher/jina');
    expect(requestBody(3)).toEqual({ key: 'jina-key' });
    expect(state.settings()?.provider).toBe('jina');
    expect(state.settings()?.jinaKeyConfigured).toBe(true);
    expect(state.jinaKeyDraft()).toBe('');
    expect(state.isSectionDirty('extraction')).toBe(false);

    state.setBrowserEndpointDraft('https://browser.example:9222');
    state.setProviderDraft('browser');
    solid.flush();
    queueEmpty();
    await expect(state.saveExtraction()).resolves.toBe(true);
    expect(requestUrl(4)).toBe('/api/settings/fetcher/browser');
    expect(requestBody(4)).toEqual({
      endpoint: 'https://browser.example:9222',
    });
    expect(state.settings()?.browserEndpointConfigured).toBe(true);
  });
});

describe('missing browser endpoint', () => {
  it('reports a missing browser endpoint', async () => {
    await load();
    state.setProviderDraft('browser');
    solid.flush();

    queue({ error: 'BrowserEndpointRequired' }, 422);
    await expect(state.saveExtraction()).resolves.toBe(false);
    solid.flush();

    expect(state.settings()?.provider).toBe('direct');
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('BrowserEndpointRequired')
    );
  });
});

describe('jina key removal', () => {
  it('deletes the stored Jina key', async () => {
    await load(makeSettings({ jinaKeyConfigured: true }));

    queueEmpty();
    await expect(state.removeJinaKey()).resolves.toBe(true);
    solid.flush();

    expect(requestUrl(2)).toBe('/api/settings/fetcher/jina/key');
    expect(requestInit(2).method).toBe('DELETE');
    expect(state.settings()?.jinaKeyConfigured).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('settings.jinaKeyDeletedToast'))
    );
  });
});
