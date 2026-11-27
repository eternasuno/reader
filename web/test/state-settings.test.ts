import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/api';
import type { SettingsDrafts } from '../src/state';

type StateModule = typeof import('../src/state');
type StoreSetter = import('solid-js').StoreSetter<SettingsDrafts>;

let state: StateModule;
let solid: typeof import('solid-js');
let fetchMock: ReturnType<typeof vi.fn>;
let drafts: SettingsDrafts;
let setDrafts: StoreSetter;
let disposeRoot: (() => void) | undefined;

const createDraftStore = (initial: Settings | null = null) =>
  solid.createRoot((dispose) => {
    const [store, setStore] = solid.createStore<SettingsDrafts>(
      state.draftsFromSettings(initial)
    );
    return { store, setStore, dispose };
  });

const fresh = async (): Promise<void> => {
  disposeRoot?.();
  vi.resetModules();
  solid = await import('solid-js');
  state = await import('../src/state');
  const created = createDraftStore();
  drafts = created.store;
  setDrafts = created.setStore;
  disposeRoot = created.dispose;
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

const pending = (): { resolve: (response: Response) => void } => {
  let resolveFn: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    resolveFn = resolve;
  });
  fetchMock.mockImplementationOnce(() => promise);
  return { resolve: resolveFn };
};

const fetchCount = (): number => fetchMock.mock.calls.length;

const makeSettings = (overrides: Partial<Settings> = {}): Settings => ({
  retention: 100,
  browserless: {
    url: 'https://browserless.example.com',
    tokenConfigured: true,
    residentialProxy: true,
  },
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
    language: 'zh',
    schedule: { hour: 8, minute: 0, timezone: 'Asia/Shanghai' },
    nextSendAt: '2026-11-20T00:00:00Z',
  },
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

describe('settings load and derived flags', () => {
  it('loads settings, drafts, derived flags and Kindle sends', async () => {
    const loaded = makeSettings();
    queue(loaded);
    queue({ running: true, items: [] });
    await state.loadSettings((next) => {
      setDrafts(() => state.draftsFromSettings(next));
    });
    solid.flush();

    expect(state.settings()?.retention).toBe(100);
    expect(drafts.retention).toBe('100');
    expect(drafts.browserlessUrl).toBe('https://browserless.example.com');
    expect(drafts.browserlessToken).toBe('');
    expect(drafts.browserlessResidentialProxy).toBe(true);
    expect(drafts.smtpSenderEmail).toBe('sender@example.com');
    expect(drafts.smtpHost).toBe('smtp.example.com');
    expect(drafts.smtpPort).toBe(587);
    expect(drafts.smtpSecurity).toBe('starttls');
    expect(drafts.smtpUser).toBe('smtp-user');
    expect(drafts.smtpPassword).toBe('');
    expect(drafts.kindleEmail).toBe('kindle@example.com');
    expect(drafts.timezone).toBe('Asia/Shanghai');
    expect(drafts.scheduleEnabled).toBe(true);
    expect(drafts.scheduleHour).toBe(8);
    expect(drafts.scheduleMinute).toBe(0);
    expect(state.settings()?.browserless?.tokenConfigured).toBe(true);
    expect(state.isSmtpConfigured()).toBe(true);
    expect(state.canSendToKindle()).toBe(true);
    expect(state.kindleRunning()).toBe(true);
    expect(state.isSaving()).toBe(false);
    expect(state.hasAnyUnsavedChanges(drafts)).toBe(false);
  });

  it('derives availability flags when services or kindle are missing', async () => {
    await load(makeSettings({ smtp: undefined, kindle: undefined }));
    expect(state.isSmtpConfigured()).toBe(false);
    expect(state.canSendToKindle()).toBe(false);

    await load(makeSettings({ kindle: undefined }));
    expect(state.isSmtpConfigured()).toBe(true);
    expect(state.canSendToKindle()).toBe(false);
  });
});

describe('Browserless drafts from settings', () => {
  it('starts Browserless drafts blank when Browserless is not configured', async () => {
    await load(makeSettings({ browserless: undefined }));

    expect(state.settings()?.browserless).toBeUndefined();
    expect(drafts.browserlessUrl).toBe('');
    expect(drafts.browserlessToken).toBe('');
    expect(drafts.browserlessResidentialProxy).toBe(false);
    expect(state.hasAnyUnsavedChanges(drafts)).toBe(false);
  });
});

describe('dirty tracking', () => {
  it('tracks articles and kindle dirty state', async () => {
    await load();

    setDrafts((d) => ({ ...d, retention: '50' }));
    solid.flush();
    expect(state.isSectionDirty('articles', drafts)).toBe(true);
    expect(state.hasAnyUnsavedChanges(drafts)).toBe(true);
    setDrafts((d) => ({ ...d, retention: '100' }));
    solid.flush();
    expect(state.isSectionDirty('articles', drafts)).toBe(false);

    setDrafts((d) => ({ ...d, kindleEmail: 'other@kindle.com' }));
    solid.flush();
    expect(state.isSectionDirty('kindle', drafts)).toBe(true);
  });
});

/** Applies a draft patch and reports whether the services section is dirty. */
const servicesDirtyAfter = (patch: Partial<SettingsDrafts>): boolean => {
  setDrafts((d) => ({ ...d, ...patch }));
  solid.flush();
  return state.isSectionDirty('services', drafts);
};

describe('services dirty tracking', () => {
  it('tracks services dirty state', async () => {
    await load();

    expect(
      servicesDirtyAfter({ browserlessToken: '   ', smtpPassword: '   ' })
    ).toBe(false);
    expect(servicesDirtyAfter({ browserlessToken: 'key' })).toBe(true);
    expect(
      servicesDirtyAfter({
        browserlessToken: '',
        browserlessUrl: 'https://other.example.com',
      })
    ).toBe(true);
    expect(
      servicesDirtyAfter({
        browserlessUrl: 'https://browserless.example.com',
        browserlessResidentialProxy: false,
      })
    ).toBe(true);
    expect(
      servicesDirtyAfter({
        browserlessResidentialProxy: true,
        smtpPassword: 'secret',
      })
    ).toBe(true);
    expect(servicesDirtyAfter({ smtpPassword: '', smtpPort: 465 })).toBe(true);
    expect(servicesDirtyAfter({ smtpPort: 587 })).toBe(false);
  });
});

describe('Browserless dirty tracking', () => {
  it('compares unconfigured Browserless drafts against blank defaults', async () => {
    await load(makeSettings({ browserless: undefined }));
    expect(state.isSectionDirty('services', drafts)).toBe(false);

    expect(
      servicesDirtyAfter({ browserlessUrl: 'https://browserless.example.com' })
    ).toBe(true);
    expect(servicesDirtyAfter({ browserlessUrl: '' })).toBe(false);
    expect(servicesDirtyAfter({ browserlessResidentialProxy: true })).toBe(
      true
    );
    expect(servicesDirtyAfter({ browserlessResidentialProxy: false })).toBe(
      false
    );
  });
});

describe('draft reset', () => {
  it('resets discarded section drafts from the saved settings', async () => {
    await load();

    setDrafts((d) => ({
      ...d,
      retention: '25',
      browserlessUrl: 'https://other.example.com',
      browserlessToken: 'secret',
      browserlessResidentialProxy: false,
      smtpHost: 'other.smtp.com',
      smtpPassword: 'secret',
      kindleEmail: 'other@kindle.com',
      timezone: 'UTC',
      scheduleEnabled: false,
      scheduleHour: 12,
      scheduleMinute: 30,
    }));
    solid.flush();
    expect(state.hasAnyUnsavedChanges(drafts)).toBe(true);

    state.resetSectionDraft('articles', setDrafts);
    state.resetSectionDraft('services', setDrafts);
    state.resetSectionDraft('kindle', setDrafts);
    solid.flush();

    expect(drafts.retention).toBe('100');
    expect(drafts.browserlessUrl).toBe('https://browserless.example.com');
    expect(drafts.browserlessToken).toBe('');
    expect(drafts.browserlessResidentialProxy).toBe(true);
    expect(drafts.smtpHost).toBe('smtp.example.com');
    expect(drafts.smtpPassword).toBe('');
    expect(drafts.kindleEmail).toBe('kindle@example.com');
    expect(drafts.timezone).toBe('Asia/Shanghai');
    expect(drafts.scheduleEnabled).toBe(true);
    expect(drafts.scheduleHour).toBe(8);
    expect(drafts.scheduleMinute).toBe(0);
    expect(state.hasAnyUnsavedChanges(drafts)).toBe(false);
  });
});

describe('save guard', () => {
  it('allows only one save at a time', async () => {
    await load();
    setDrafts((d) => ({ ...d, retention: '50' }));
    solid.flush();

    const slow = pending();
    const saving = state.saveRetention(drafts);
    solid.flush();
    expect(state.isSaving()).toBe(true);
    expect(state.savingAction()).toBe('retention');

    await expect(state.saveBrowserless(drafts, setDrafts)).resolves.toBe(false);
    expect(fetchCount()).toBe(3);

    slow.resolve(noContent());
    await saving;
    solid.flush();
    expect(state.isSaving()).toBe(false);
  });
});

describe('secret draft disposal', () => {
  it('clears secret drafts via clearSecretDrafts and initializes fresh stores without secrets', async () => {
    await load();
    setDrafts((d) => ({
      ...d,
      browserlessToken: 'browserless-secret',
      smtpPassword: 'smtp-secret',
    }));
    solid.flush();
    expect(state.hasAnyUnsavedChanges(drafts)).toBe(true);

    state.clearSecretDrafts(setDrafts);
    solid.flush();
    expect(drafts.browserlessToken).toBe('');
    expect(drafts.browserlessUrl).toBe('https://browserless.example.com');
    expect(drafts.smtpPassword).toBe('');
    expect(state.hasAnyUnsavedChanges(drafts)).toBe(false);

    const nextVisit = createDraftStore(state.settings());
    expect(nextVisit.store.retention).toBe('100');
    expect(nextVisit.store.smtpHost).toBe('smtp.example.com');
    expect(nextVisit.store.browserlessUrl).toBe(
      'https://browserless.example.com'
    );
    expect(nextVisit.store.browserlessToken).toBe('');
    expect(nextVisit.store.smtpPassword).toBe('');
    nextVisit.dispose();
  });
});
