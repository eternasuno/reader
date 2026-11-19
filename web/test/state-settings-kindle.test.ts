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

describe('kindle save', () => {
  it('saves Kindle settings and omits blank secrets', async () => {
    await load();
    state.setKindleEmailDraft('new@kindle.com');
    state.setSmtpPortDraft(465);
    state.setSmtpSecurityDraft('tls');
    solid.flush();

    queueEmpty();
    await expect(state.saveKindle()).resolves.toBe(true);
    solid.flush();

    expect(requestUrl(2)).toBe('/api/settings/kindle');
    const body = requestBody(2) as Record<string, unknown>;
    expect(body.kindleEmail).toBe('new@kindle.com');
    expect(body.smtpPort).toBe(465);
    expect(body.smtpSecurity).toBe('tls');
    expect(body.smtpUser).toBe('smtp-user');
    expect('smtpPassword' in body).toBe(false);
    expect(state.settings()?.kindle?.smtpPasswordConfigured).toBe(true);
    expect(state.isSectionDirty('kindle')).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('settings.kindleSavedToast'))
    );
  });
});

describe('smtp password save', () => {
  it('includes a typed SMTP password and clears it after saving', async () => {
    await load();
    state.setSmtpPasswordDraft('smtp-secret');
    solid.flush();

    queueEmpty();
    await expect(state.saveKindle()).resolves.toBe(true);
    solid.flush();

    expect((requestBody(2) as Record<string, unknown>).smtpPassword).toBe(
      'smtp-secret'
    );
    expect(state.smtpPasswordDraft()).toBe('');
  });
});

describe('kindle save failure', () => {
  it('reports invalid Kindle settings', async () => {
    await load();
    state.setSmtpPortDraft(0);
    solid.flush();

    queue({ error: 'InvalidKindleSetting' }, 400);
    await expect(state.saveKindle()).resolves.toBe(false);
    solid.flush();

    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('InvalidKindleSetting')
    );
    expect(state.isSaving()).toBe(false);
  });
});

describe('smtp password removal', () => {
  it('deletes the stored SMTP password', async () => {
    await load();

    queueEmpty();
    await expect(state.removeKindlePassword()).resolves.toBe(true);
    solid.flush();

    expect(requestUrl(2)).toBe('/api/settings/kindle/password');
    expect(state.settings()?.kindle?.smtpPasswordConfigured).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('settings.smtpPasswordDeletedToast'))
    );
  });
});
