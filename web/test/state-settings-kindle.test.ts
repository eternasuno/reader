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
  smtp: {
    senderEmail: 'sender@example.com',
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls',
    user: 'smtp-user',
    passwordConfigured: true,
  },
  kindle: {
    kindleEmail: 'kindle@example.com',
    sendTime: '08:00',
    nextSendAt: '2026-11-20T08:00:00Z',
  },
  ...overrides,
});

const load = async (loaded: Settings = makeSettings()): Promise<void> => {
  queue(loaded);
  queue({ running: false, items: [] });
  await state.loadSettings();
  solid.flush();
};

describe('kindle save', () => {
  it('saves only kindleEmail and sendTime and clears dirty state', async () => {
    await load();
    state.setKindleEmailDraft(' new@kindle.com ');
    state.setSendTimeDraft('07:30');
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
    await expect(state.saveKindle()).resolves.toBe(true);
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
    expect(state.kindleEmailDraft()).toBe('new@kindle.com');
    expect(state.isSectionDirty('kindle')).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('settings.kindleSavedToast'))
    );
  });
});

describe('kindle schedule disable', () => {
  it('omits blank sendTime when disabling scheduled sends', async () => {
    await load();
    state.setSendTimeDraft('   ');
    solid.flush();

    queueEmpty();
    queue(makeSettings({ kindle: { kindleEmail: 'kindle@example.com' } }));
    await expect(state.saveKindle()).resolves.toBe(true);
    solid.flush();

    const body = requestBody(2) as Record<string, unknown>;
    expect(body).toEqual({ kindleEmail: 'kindle@example.com' });
    expect('sendTime' in body).toBe(false);
    expect(state.settings()?.kindle).toEqual({
      kindleEmail: 'kindle@example.com',
    });
    expect(state.settings()?.kindle?.nextSendAt).toBeUndefined();
    expect(state.isSectionDirty('kindle')).toBe(false);
  });
});

describe('kindle save fallback', () => {
  it('falls back to submitted values and clears nextSendAt when re-read fails', async () => {
    await load();
    state.setKindleEmailDraft('fallback@kindle.com');
    state.setSendTimeDraft('');
    solid.flush();

    queueEmpty();
    queue({ error: 'SettingRepositoryError' }, 500);
    await expect(state.saveKindle()).resolves.toBe(true);
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
  it('reports invalid Kindle settings', async () => {
    await load();
    state.setKindleEmailDraft('bad-email');
    solid.flush();

    queue({ error: 'InvalidKindleSetting' }, 400);
    await expect(state.saveKindle()).resolves.toBe(false);
    solid.flush();

    expect(state.settings()?.kindle?.kindleEmail).toBe('kindle@example.com');
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('InvalidKindleSetting')
    );
    expect(state.isSaving()).toBe(false);
  });

  it('reports missing SMTP configuration', async () => {
    await load(makeSettings({ smtp: undefined, kindle: undefined }));
    state.setKindleEmailDraft('a@kindle.com');
    solid.flush();

    queue({ error: 'SMTPNotConfigured' }, 422);
    await expect(state.saveKindle()).resolves.toBe(false);
    solid.flush();

    expect(state.settings()?.kindle).toBeUndefined();
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('SMTPNotConfigured')
    );
  });
});
