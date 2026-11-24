import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { Settings, SmtpSettingsView } from '../src/api';
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

const fresh = async (): Promise<void> => {
  vi.resetModules();
  solid = await import('solid-js');
  i18n = await import('../src/i18n');
  ui = await import('../src/ui');
  state = await import('../src/state');
  onTestFinished(
    solid.createRoot((dispose) => {
      const [store, setStore] = solid.createStore<SettingsDrafts>(
        state.draftsFromSettings(null)
      );
      drafts = store;
      setDrafts = setStore;
      return dispose;
    })
  );
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

const queue = (body: unknown, status = 200): void => {
  fetchMock.mockResolvedValueOnce(json(body, status));
};

const queueEmpty = (): void => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
};

const requestUrl = (call = 0): string =>
  String(fetchMock.mock.calls[call]?.[0]);

const requestMethod = (call = 0): string =>
  String(((fetchMock.mock.calls[call]?.[1] ?? {}) as RequestInit).method);

const requestBody = (call = 0): unknown => {
  const body = ((fetchMock.mock.calls[call]?.[1] ?? {}) as RequestInit).body;
  return typeof body === 'string' ? JSON.parse(body) : body;
};

const SMTP_REQ = {
  senderEmail: 'sender@example.com',
  host: 'smtp.example.com',
  port: 465,
  security: 'tls' as const,
};

const SMTP_VIEW: SmtpSettingsView = {
  ...SMTP_REQ,
  passwordConfigured: true,
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
  await state.loadSettings((next) => {
    setDrafts(() => state.draftsFromSettings(next));
  });
  solid.flush();
};

const patchDrafts = (patch: Partial<SettingsDrafts>): void => {
  setDrafts((d) => ({ ...d, ...patch }));
  solid.flush();
};

const toastIs = (message: string): void => {
  expect(ui.currentToast()?.message).toBe(message);
};

const fillSmtpDrafts = (password = ''): void =>
  patchDrafts({
    smtpSenderEmail: ' sender@example.com ',
    smtpHost: ' smtp.example.com ',
    smtpPort: 465,
    smtpSecurity: 'tls',
    smtpUser: ' user@example.com ',
    smtpPassword: password,
  });

describe('saveJinaKey', () => {
  it('saves Jina key, updates state, clears draft and shows toast', async () => {
    await load();
    patchDrafts({ jinaKey: ' jina-secret ' });

    queueEmpty();
    await expect(state.saveJinaKey(drafts, setDrafts)).resolves.toBe(true);
    solid.flush();

    expect(requestUrl(2)).toBe('/api/settings/services/jina');
    expect(requestMethod(2)).toBe('PUT');
    expect(requestBody(2)).toEqual({ key: 'jina-secret' });
    expect(state.settings()?.jinaKeyConfigured).toBe(true);
    expect(drafts.jinaKey).toBe('');
    expect(state.isSectionDirty('services', drafts)).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('settings.jinaKeySavedToast'))
    );
  });

  it('shows error toast when saving Jina key fails', async () => {
    await load();
    queue({ error: 'InvalidJinaKey' }, 400);

    await expect(state.saveJinaKey(drafts, setDrafts)).resolves.toBe(false);
    solid.flush();

    expect(state.settings()?.jinaKeyConfigured).toBe(false);
    toastIs(i18n.translateErrorCode('InvalidJinaKey'));
  });
});

describe('removeJinaKey', () => {
  it('deletes Jina key, updates state and shows error toast on failure', async () => {
    await load(makeSettings({ jinaKeyConfigured: true }));

    queueEmpty();
    await expect(state.removeJinaKey(setDrafts)).resolves.toBe(true);
    solid.flush();

    expect(requestUrl(2)).toBe('/api/settings/services/jina');
    expect(requestMethod(2)).toBe('DELETE');
    expect(state.settings()?.jinaKeyConfigured).toBe(false);
    toastIs(String(i18n.t('settings.jinaKeyDeletedToast')));

    queue({ error: 'SettingRepositoryError' }, 500);
    await expect(state.removeJinaKey(setDrafts)).resolves.toBe(false);
    solid.flush();
    toastIs(i18n.translateErrorCode('SettingRepositoryError'));
  });
});

describe('saveBrowserEndpoint', () => {
  it('saves browser endpoint, updates availability and clears draft', async () => {
    await load();
    patchDrafts({ browserEndpoint: ' http://browser:9222 ' });

    queueEmpty();
    await expect(state.saveBrowserEndpoint(drafts, setDrafts)).resolves.toBe(
      true
    );
    solid.flush();

    expect(requestUrl(2)).toBe('/api/settings/services/browser');
    expect(requestMethod(2)).toBe('PUT');
    expect(requestBody(2)).toEqual({ endpoint: 'http://browser:9222' });
    expect(state.settings()?.browserEndpointConfigured).toBe(true);
    expect(state.isBrowserAvailable()).toBe(true);
    expect(drafts.browserEndpoint).toBe('');
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('settings.browserEndpointSavedToast'))
    );
  });

  it('shows error toast when saving browser endpoint fails', async () => {
    await load();
    patchDrafts({ browserEndpoint: 'ftp://invalid' });
    queue({ error: 'InvalidEndpoint' }, 400);

    await expect(state.saveBrowserEndpoint(drafts, setDrafts)).resolves.toBe(
      false
    );
    solid.flush();

    expect(state.settings()?.browserEndpointConfigured).toBe(false);
    toastIs(i18n.translateErrorCode('InvalidEndpoint'));
  });
});

describe('removeBrowserEndpoint', () => {
  it('clears endpoint and falls back browser provider to direct', async () => {
    await load(
      makeSettings({ provider: 'browser', browserEndpointConfigured: true })
    );

    queueEmpty();
    await expect(state.removeBrowserEndpoint(setDrafts)).resolves.toBe(true);
    solid.flush();

    expect(requestUrl(2)).toBe('/api/settings/services/browser');
    expect(requestMethod(2)).toBe('DELETE');
    expect(state.settings()?.browserEndpointConfigured).toBe(false);
    expect(state.isBrowserAvailable()).toBe(false);
    expect(state.settings()?.provider).toBe('direct');
    expect(drafts.provider).toBe('direct');
    toastIs(String(i18n.t('settings.browserEndpointDeletedToast')));
  });

  it('keeps non-browser provider and surfaces errors', async () => {
    await load(
      makeSettings({ provider: 'jina', browserEndpointConfigured: true })
    );

    queue({ error: 'SettingRepositoryError' }, 500);
    await expect(state.removeBrowserEndpoint(setDrafts)).resolves.toBe(false);
    solid.flush();
    toastIs(i18n.translateErrorCode('SettingRepositoryError'));

    queueEmpty();
    await expect(state.removeBrowserEndpoint(setDrafts)).resolves.toBe(true);
    solid.flush();
    expect(state.settings()?.provider).toBe('jina');
    expect(drafts.provider).toBe('jina');
  });
});

describe('saveSmtp', () => {
  it('saves SMTP settings, preserves passwordConfigured and omits blank password', async () => {
    await load(makeSettings({ kindle: { kindleEmail: 'kindle@example.com' } }));
    fillSmtpDrafts(' smtp-secret ');

    queueEmpty();
    await expect(state.saveSmtp(drafts, setDrafts)).resolves.toBe(true);
    solid.flush();

    expect(requestUrl(2)).toBe('/api/settings/services/smtp');
    expect(requestMethod(2)).toBe('PUT');
    expect(requestBody(2)).toEqual({
      ...SMTP_REQ,
      user: 'user@example.com',
      password: ' smtp-secret ',
    });
    expect(state.settings()?.smtp).toEqual({
      ...SMTP_VIEW,
      user: 'user@example.com',
    });
    expect(drafts.smtpPassword).toBe('');
    expect(state.isSmtpConfigured()).toBe(true);
    expect(state.canSendToKindle()).toBe(true);
    expect(state.isSectionDirty('services', drafts)).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      String(i18n.t('settings.smtpSavedToast'))
    );

    patchDrafts({ smtpPort: 587, smtpSecurity: 'starttls' });
    queueEmpty();
    await expect(state.saveSmtp(drafts, setDrafts)).resolves.toBe(true);
    expect(requestBody(3)).not.toHaveProperty('password');
    expect(state.settings()?.smtp?.passwordConfigured).toBe(true);
  });

  it('shows error toast when saving SMTP fails', async () => {
    await load();
    queue({ error: 'InvalidSMTPSetting' }, 400);

    await expect(state.saveSmtp(drafts, setDrafts)).resolves.toBe(false);
    solid.flush();

    expect(state.settings()?.smtp).toBeUndefined();
    toastIs(i18n.translateErrorCode('InvalidSMTPSetting'));
  });
});

describe('saveSmtp whitespace password', () => {
  it('omits whitespace-only password when no password is stored', async () => {
    await load();
    fillSmtpDrafts('   ');
    queueEmpty();
    await expect(state.saveSmtp(drafts, setDrafts)).resolves.toBe(true);
    expect(requestBody(2)).not.toHaveProperty('password');
    expect(state.settings()?.smtp?.passwordConfigured).toBe(false);
    expect(state.isSectionDirty('services', drafts)).toBe(false);
  });
});

describe('removeSmtpPassword', () => {
  it('deletes stored password and shows error toast on failure', async () => {
    await load(makeSettings({ smtp: SMTP_VIEW }));

    queueEmpty();
    await expect(state.removeSmtpPassword(setDrafts)).resolves.toBe(true);
    solid.flush();

    expect(requestUrl(2)).toBe('/api/settings/services/smtp/password');
    expect(requestMethod(2)).toBe('DELETE');
    expect(state.settings()?.smtp?.passwordConfigured).toBe(false);
    toastIs(String(i18n.t('settings.smtpPasswordDeletedToast')));

    queue({ error: 'SettingRepositoryError' }, 500);
    await expect(state.removeSmtpPassword(setDrafts)).resolves.toBe(false);
    solid.flush();
    toastIs(i18n.translateErrorCode('SettingRepositoryError'));
  });
});

describe('removeSmtp', () => {
  it('clears SMTP settings, drafts and availability flags', async () => {
    await load(
      makeSettings({
        smtp: SMTP_VIEW,
        kindle: { kindleEmail: 'kindle@example.com' },
      })
    );

    queueEmpty();
    await expect(state.removeSmtp(setDrafts)).resolves.toBe(true);
    solid.flush();

    expect(requestUrl(2)).toBe('/api/settings/services/smtp');
    expect(requestMethod(2)).toBe('DELETE');
    expect(state.settings()?.smtp).toBeUndefined();
    expect(state.isSmtpConfigured()).toBe(false);
    expect(state.canSendToKindle()).toBe(false);
    expect(drafts.smtpSenderEmail).toBe('');
    expect(drafts.smtpHost).toBe('');
    expect(drafts.smtpPort).toBe(0);
    expect(state.isSectionDirty('services', drafts)).toBe(false);
    toastIs(String(i18n.t('settings.smtpDeletedToast')));
  });

  it('shows error toast when clearing SMTP fails', async () => {
    await load(makeSettings({ smtp: SMTP_VIEW }));
    queue({ error: 'SettingRepositoryError' }, 500);

    await expect(state.removeSmtp(setDrafts)).resolves.toBe(false);
    solid.flush();

    expect(state.settings()?.smtp).toBeDefined();
    toastIs(i18n.translateErrorCode('SettingRepositoryError'));
  });
});
