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
  await state.loadSettings((next) => {
    setDrafts(() => state.draftsFromSettings(next));
  });
  solid.flush();
};

describe('settings load and derived flags', () => {
  it('loads settings, drafts, derived flags and Kindle sends', async () => {
    const loaded = makeSettings({ browserEndpointConfigured: true });
    queue(loaded);
    queue({ running: true, items: [] });
    await state.loadSettings((next) => {
      setDrafts(() => state.draftsFromSettings(next));
    });
    solid.flush();

    expect(state.settings()?.retention).toBe(100);
    expect(drafts.retention).toBe(100);
    expect(drafts.provider).toBe('direct');
    expect(drafts.jinaKey).toBe('');
    expect(drafts.browserEndpoint).toBe('');
    expect(drafts.smtpSenderEmail).toBe('sender@example.com');
    expect(drafts.smtpHost).toBe('smtp.example.com');
    expect(drafts.smtpPort).toBe(587);
    expect(drafts.smtpSecurity).toBe('starttls');
    expect(drafts.smtpUser).toBe('smtp-user');
    expect(drafts.smtpPassword).toBe('');
    expect(drafts.kindleEmail).toBe('kindle@example.com');
    expect(drafts.sendTime).toBe('08:00');
    expect(state.isBrowserAvailable()).toBe(true);
    expect(state.isSmtpConfigured()).toBe(true);
    expect(state.canSendToKindle()).toBe(true);
    expect(state.kindleRunning()).toBe(true);
    expect(state.isSaving()).toBe(false);
    expect(state.hasAnyUnsavedChanges(drafts)).toBe(false);
  });

  it('derives availability flags when services or kindle are missing', async () => {
    await load(makeSettings({ smtp: undefined, kindle: undefined }));
    expect(state.isBrowserAvailable()).toBe(false);
    expect(state.isSmtpConfigured()).toBe(false);
    expect(state.canSendToKindle()).toBe(false);

    await load(makeSettings({ kindle: undefined }));
    expect(state.isSmtpConfigured()).toBe(true);
    expect(state.canSendToKindle()).toBe(false);
  });
});

describe('dirty tracking', () => {
  it('tracks articles, extraction and kindle dirty state', async () => {
    await load();

    setDrafts((d) => ({ ...d, retention: 50 }));
    solid.flush();
    expect(state.isSectionDirty('articles', drafts)).toBe(true);
    expect(state.hasAnyUnsavedChanges(drafts)).toBe(true);
    setDrafts((d) => ({ ...d, retention: 100 }));
    solid.flush();
    expect(state.isSectionDirty('articles', drafts)).toBe(false);

    setDrafts((d) => ({ ...d, provider: 'jina' }));
    solid.flush();
    expect(state.isSectionDirty('extraction', drafts)).toBe(true);
    setDrafts((d) => ({ ...d, provider: 'direct' }));
    solid.flush();
    expect(state.isSectionDirty('extraction', drafts)).toBe(false);

    setDrafts((d) => ({ ...d, kindleEmail: 'other@kindle.com' }));
    solid.flush();
    expect(state.isSectionDirty('kindle', drafts)).toBe(true);
    setDrafts((d) => ({
      ...d,
      kindleEmail: 'kindle@example.com',
      sendTime: '09:00',
    }));
    solid.flush();
    expect(state.isSectionDirty('kindle', drafts)).toBe(true);
  });
});

describe('services dirty tracking', () => {
  it('tracks services dirty state', async () => {
    await load();

    setDrafts((d) => ({
      ...d,
      jinaKey: '   ',
      browserEndpoint: '   ',
      smtpPassword: '   ',
    }));
    solid.flush();
    expect(state.isSectionDirty('services', drafts)).toBe(false);
    setDrafts((d) => ({ ...d, jinaKey: 'key' }));
    solid.flush();
    expect(state.isSectionDirty('services', drafts)).toBe(true);
    setDrafts((d) => ({
      ...d,
      jinaKey: '',
      browserEndpoint: 'http://browser:9222',
    }));
    solid.flush();
    expect(state.isSectionDirty('services', drafts)).toBe(true);
    setDrafts((d) => ({
      ...d,
      browserEndpoint: '',
      smtpPassword: 'secret',
    }));
    solid.flush();
    expect(state.isSectionDirty('services', drafts)).toBe(true);
    setDrafts((d) => ({
      ...d,
      smtpPassword: '',
      smtpPort: 465,
    }));
    solid.flush();
    expect(state.isSectionDirty('services', drafts)).toBe(true);
    setDrafts((d) => ({ ...d, smtpPort: 587 }));
    solid.flush();
    expect(state.isSectionDirty('services', drafts)).toBe(false);
  });
});

describe('draft reset', () => {
  it('resets discarded section drafts from the saved settings', async () => {
    await load();

    setDrafts((d) => ({
      ...d,
      retention: 25,
      provider: 'jina',
      jinaKey: 'secret',
      browserEndpoint: 'http://browser:9222',
      smtpHost: 'other.smtp.com',
      smtpPassword: 'secret',
      kindleEmail: 'other@kindle.com',
      sendTime: '12:00',
    }));
    solid.flush();
    expect(state.hasAnyUnsavedChanges(drafts)).toBe(true);

    state.resetSectionDraft('articles', setDrafts);
    state.resetSectionDraft('extraction', setDrafts);
    state.resetSectionDraft('services', setDrafts);
    state.resetSectionDraft('kindle', setDrafts);
    solid.flush();

    expect(drafts.retention).toBe(100);
    expect(drafts.provider).toBe('direct');
    expect(drafts.jinaKey).toBe('');
    expect(drafts.browserEndpoint).toBe('');
    expect(drafts.smtpHost).toBe('smtp.example.com');
    expect(drafts.smtpPassword).toBe('');
    expect(drafts.kindleEmail).toBe('kindle@example.com');
    expect(drafts.sendTime).toBe('08:00');
    expect(state.hasAnyUnsavedChanges(drafts)).toBe(false);
  });
});

describe('save guard', () => {
  it('allows only one save at a time', async () => {
    await load();
    setDrafts((d) => ({ ...d, retention: 50 }));
    solid.flush();

    const slow = pending();
    const saving = state.saveRetention(drafts);
    solid.flush();
    expect(state.isSaving()).toBe(true);
    expect(state.savingAction()).toBe('retention');

    await expect(state.saveProvider(drafts)).resolves.toBe(false);
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
      jinaKey: 'jina-secret',
      browserEndpoint: 'http://browser:9222',
      smtpPassword: 'smtp-secret',
    }));
    solid.flush();
    expect(state.hasAnyUnsavedChanges(drafts)).toBe(true);

    state.clearSecretDrafts(setDrafts);
    solid.flush();
    expect(drafts.jinaKey).toBe('');
    expect(drafts.browserEndpoint).toBe('');
    expect(drafts.smtpPassword).toBe('');
    expect(state.hasAnyUnsavedChanges(drafts)).toBe(false);

    const nextVisit = createDraftStore(state.settings());
    expect(nextVisit.store.retention).toBe(100);
    expect(nextVisit.store.smtpHost).toBe('smtp.example.com');
    expect(nextVisit.store.jinaKey).toBe('');
    expect(nextVisit.store.browserEndpoint).toBe('');
    expect(nextVisit.store.smtpPassword).toBe('');
    nextVisit.dispose();
  });
});
