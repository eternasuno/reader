import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrowserlessSettingsView, Settings } from '../src/api';
import type { SettingsDrafts } from '../src/state';
import { createStateTestContext } from './support/state-fixture';

type StoreSetter = import('solid-js').StoreSetter<SettingsDrafts>;

const ctx = createStateTestContext();
let drafts: SettingsDrafts;
let setDrafts: StoreSetter;
let disposeRoot: (() => void) | undefined;

beforeEach(async () => {
  await ctx.reset();
  disposeRoot = ctx.solid.createRoot((dispose) => {
    const [store, setStore] = ctx.solid.createStore<SettingsDrafts>(
      ctx.state.draftsFromSettings(null)
    );
    drafts = store;
    setDrafts = setStore;
    return dispose;
  });
});

afterEach(() => {
  disposeRoot?.();
  disposeRoot = undefined;
});

const BL_URL = 'https://browserless.example.com';
const OTHER_URL = 'https://other.example.com';

const BL_VIEW: BrowserlessSettingsView = {
  url: BL_URL,
  tokenConfigured: true,
  residentialProxy: false,
};

const makeSettings = (overrides: Partial<Settings> = {}): Settings => ({
  retention: 100,
  ...overrides,
});

const load = async (loaded: Settings = makeSettings()): Promise<void> => {
  ctx.queue(loaded);
  ctx.queue({ running: false, items: [] });
  await ctx.state.loadSettings((next) => {
    setDrafts(() => ctx.state.draftsFromSettings(next));
  });
  ctx.solid.flush();
};

const patchDrafts = (patch: Partial<SettingsDrafts>): void => {
  setDrafts((d) => ({ ...d, ...patch }));
  ctx.solid.flush();
};

const requestMethod = (call = 0): string =>
  String(ctx.requestInit(call).method);

const toastIs = (message: string): void => {
  expect(ctx.ui.currentToast()?.message).toBe(message);
};

const servicesDirty = (): boolean =>
  ctx.state.isSectionDirty('services', drafts);

describe('saveBrowserless', () => {
  it('saves URL, untrimmed token and proxy, updates state, clears the token draft and shows toast', async () => {
    await load();
    patchDrafts({
      browserlessUrl: ` ${BL_URL} `,
      browserlessToken: ' bl-secret ',
      browserlessResidentialProxy: true,
    });

    ctx.queueEmpty();
    await expect(ctx.state.saveBrowserless(drafts, setDrafts)).resolves.toBe(
      true
    );
    ctx.solid.flush();

    expect(ctx.requestUrl(2)).toBe('/api/settings/services/browserless');
    expect(requestMethod(2)).toBe('PUT');
    expect(ctx.requestBody(2)).toEqual({
      url: BL_URL,
      token: ' bl-secret ',
      residentialProxy: true,
    });
    expect(ctx.state.settings()?.browserless).toEqual({
      url: BL_URL,
      tokenConfigured: true,
      residentialProxy: true,
    });
    expect(drafts.browserlessUrl).toBe(BL_URL);
    expect(drafts.browserlessToken).toBe('');
    expect(drafts.browserlessResidentialProxy).toBe(true);
    expect(servicesDirty()).toBe(false);
    expect(ctx.state.isSaving()).toBe(false);
    toastIs(String(ctx.i18n.t('settings.browserlessSavedToast')));
  });
});

describe('saveBrowserless stored token', () => {
  it('omits a blank token and keeps tokenConfigured when a token is stored', async () => {
    await load(makeSettings({ browserless: BL_VIEW }));
    patchDrafts({
      browserlessToken: '   ',
      browserlessResidentialProxy: true,
    });

    ctx.queueEmpty();
    await expect(ctx.state.saveBrowserless(drafts, setDrafts)).resolves.toBe(
      true
    );
    ctx.solid.flush();

    expect(ctx.requestBody(2)).toEqual({ url: BL_URL, residentialProxy: true });
    expect(ctx.requestBody(2)).not.toHaveProperty('token');
    expect(ctx.state.settings()?.browserless).toEqual({
      ...BL_VIEW,
      residentialProxy: true,
    });
    expect(drafts.browserlessToken).toBe('');
    expect(servicesDirty()).toBe(false);
  });
});

describe('saveBrowserless whitespace token', () => {
  it('omits a whitespace-only token when no token is stored', async () => {
    await load();
    patchDrafts({ browserlessUrl: BL_URL, browserlessToken: '   ' });

    ctx.queueEmpty();
    await expect(ctx.state.saveBrowserless(drafts, setDrafts)).resolves.toBe(
      true
    );
    ctx.solid.flush();

    expect(ctx.requestBody(2)).not.toHaveProperty('token');
    expect(ctx.state.settings()?.browserless).toEqual({
      url: BL_URL,
      tokenConfigured: false,
      residentialProxy: false,
    });
    expect(servicesDirty()).toBe(false);
  });
});

describe('saveBrowserless failure', () => {
  it('keeps settings and drafts and shows an error toast', async () => {
    await load(makeSettings({ browserless: BL_VIEW }));
    patchDrafts({ browserlessUrl: OTHER_URL });

    ctx.queue({ error: 'SettingRepositoryError' }, 500);
    await expect(ctx.state.saveBrowserless(drafts, setDrafts)).resolves.toBe(
      false
    );
    ctx.solid.flush();

    expect(ctx.state.settings()?.browserless).toEqual(BL_VIEW);
    expect(drafts.browserlessUrl).toBe(OTHER_URL);
    expect(servicesDirty()).toBe(true);
    toastIs(ctx.i18n.translateErrorCode('SettingRepositoryError'));
  });
});

describe('removeBrowserlessToken', () => {
  it('deletes the stored token, keeps the other fields and clears the token draft', async () => {
    await load(makeSettings({ browserless: BL_VIEW }));
    patchDrafts({ browserlessToken: 'typed-secret' });

    ctx.queueEmpty();
    await expect(ctx.state.removeBrowserlessToken(setDrafts)).resolves.toBe(
      true
    );
    ctx.solid.flush();

    expect(ctx.requestUrl(2)).toBe('/api/settings/services/browserless/token');
    expect(requestMethod(2)).toBe('DELETE');
    expect(ctx.state.settings()?.browserless).toEqual({
      ...BL_VIEW,
      tokenConfigured: false,
    });
    expect(drafts.browserlessToken).toBe('');
    expect(drafts.browserlessUrl).toBe(BL_URL);
    expect(servicesDirty()).toBe(false);
    toastIs(String(ctx.i18n.t('settings.browserlessTokenDeletedToast')));
  });
});

describe('removeBrowserlessToken edge cases', () => {
  it('does not create Browserless settings when none are saved', async () => {
    await load();

    ctx.queueEmpty();
    await expect(ctx.state.removeBrowserlessToken(setDrafts)).resolves.toBe(
      true
    );
    ctx.solid.flush();

    expect(ctx.state.settings()?.browserless).toBeUndefined();
  });

  it('shows an error toast and keeps the token flag on failure', async () => {
    await load(makeSettings({ browserless: BL_VIEW }));

    ctx.queue({ error: 'SettingRepositoryError' }, 500);
    await expect(ctx.state.removeBrowserlessToken(setDrafts)).resolves.toBe(
      false
    );
    ctx.solid.flush();

    expect(ctx.state.settings()?.browserless?.tokenConfigured).toBe(true);
    toastIs(ctx.i18n.translateErrorCode('SettingRepositoryError'));
  });
});

describe('removeBrowserless', () => {
  it('clears Browserless settings and resets its drafts', async () => {
    await load(
      makeSettings({ browserless: { ...BL_VIEW, residentialProxy: true } })
    );
    patchDrafts({ browserlessToken: 'typed-secret' });

    ctx.queueEmpty();
    await expect(ctx.state.removeBrowserless(setDrafts)).resolves.toBe(true);
    ctx.solid.flush();

    expect(ctx.requestUrl(2)).toBe('/api/settings/services/browserless');
    expect(requestMethod(2)).toBe('DELETE');
    expect(ctx.state.settings()?.browserless).toBeUndefined();
    expect(drafts.browserlessUrl).toBe('');
    expect(drafts.browserlessToken).toBe('');
    expect(drafts.browserlessResidentialProxy).toBe(false);
    expect(servicesDirty()).toBe(false);
    toastIs(String(ctx.i18n.t('settings.browserlessDeletedToast')));
  });
});

describe('removeBrowserless failure', () => {
  it('keeps settings and drafts and shows an error toast', async () => {
    await load(makeSettings({ browserless: BL_VIEW }));
    ctx.queue({ error: 'SettingRepositoryError' }, 500);

    await expect(ctx.state.removeBrowserless(setDrafts)).resolves.toBe(false);
    ctx.solid.flush();

    expect(ctx.state.settings()?.browserless).toEqual(BL_VIEW);
    expect(drafts.browserlessUrl).toBe(BL_URL);
    toastIs(ctx.i18n.translateErrorCode('SettingRepositoryError'));
  });
});
