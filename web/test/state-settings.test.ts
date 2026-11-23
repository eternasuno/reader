import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/api';

type StateModule = typeof import('../src/state');

let state: StateModule;
let solid: typeof import('solid-js');
let fetchMock: ReturnType<typeof vi.fn>;
let disposeDrafts: (() => void) | undefined;

const fresh = async (): Promise<void> => {
  disposeDrafts?.();
  vi.resetModules();
  solid = await import('solid-js');
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
  await state.loadSettings();
  solid.flush();
};

describe('settings load and derived flags', () => {
  it('loads settings, drafts, derived flags and Kindle sends', async () => {
    const loaded = makeSettings({ browserEndpointConfigured: true });
    queue(loaded);
    queue({ running: true, items: [] });
    await state.loadSettings();
    solid.flush();

    expect(state.settings()?.retention).toBe(100);
    expect(state.retentionDraft()).toBe(100);
    expect(state.providerDraft()).toBe('direct');
    expect(state.jinaKeyDraft()).toBe('');
    expect(state.browserEndpointDraft()).toBe('');
    expect(state.smtpSenderEmailDraft()).toBe('sender@example.com');
    expect(state.smtpHostDraft()).toBe('smtp.example.com');
    expect(state.smtpPortDraft()).toBe(587);
    expect(state.smtpSecurityDraft()).toBe('starttls');
    expect(state.smtpUserDraft()).toBe('smtp-user');
    expect(state.smtpPasswordDraft()).toBe('');
    expect(state.kindleEmailDraft()).toBe('kindle@example.com');
    expect(state.sendTimeDraft()).toBe('08:00');
    expect(state.isBrowserAvailable()).toBe(true);
    expect(state.isSmtpConfigured()).toBe(true);
    expect(state.canSendToKindle()).toBe(true);
    expect(state.kindleRunning()).toBe(true);
    expect(state.isSaving()).toBe(false);
    expect(state.hasAnyUnsavedChanges()).toBe(false);
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

    state.setRetentionDraft(50);
    solid.flush();
    expect(state.isSectionDirty('articles')).toBe(true);
    expect(state.hasAnyUnsavedChanges()).toBe(true);
    state.setRetentionDraft(100);
    solid.flush();
    expect(state.isSectionDirty('articles')).toBe(false);

    state.setProviderDraft('jina');
    solid.flush();
    expect(state.isSectionDirty('extraction')).toBe(true);
    state.setProviderDraft('direct');
    solid.flush();
    expect(state.isSectionDirty('extraction')).toBe(false);

    state.setKindleEmailDraft('other@kindle.com');
    solid.flush();
    expect(state.isSectionDirty('kindle')).toBe(true);
    state.setKindleEmailDraft('kindle@example.com');
    state.setSendTimeDraft('09:00');
    solid.flush();
    expect(state.isSectionDirty('kindle')).toBe(true);
  });
});

describe('services dirty tracking', () => {
  it('tracks services dirty state', async () => {
    await load();

    state.setJinaKeyDraft('   ');
    state.setBrowserEndpointDraft('   ');
    state.setSmtpPasswordDraft('   ');
    solid.flush();
    expect(state.isSectionDirty('services')).toBe(false);
    state.setJinaKeyDraft('key');
    solid.flush();
    expect(state.isSectionDirty('services')).toBe(true);
    state.setJinaKeyDraft('');
    state.setBrowserEndpointDraft('http://browser:9222');
    solid.flush();
    expect(state.isSectionDirty('services')).toBe(true);
    state.setBrowserEndpointDraft('');
    state.setSmtpPasswordDraft('secret');
    solid.flush();
    expect(state.isSectionDirty('services')).toBe(true);
    state.setSmtpPasswordDraft('');
    state.setSmtpPortDraft(465);
    solid.flush();
    expect(state.isSectionDirty('services')).toBe(true);
    state.setSmtpPortDraft(587);
    solid.flush();
    expect(state.isSectionDirty('services')).toBe(false);
  });
});

describe('draft reset', () => {
  it('resets discarded section drafts from the saved settings', async () => {
    await load();

    state.setRetentionDraft(25);
    state.setProviderDraft('jina');
    state.setJinaKeyDraft('secret');
    state.setBrowserEndpointDraft('http://browser:9222');
    state.setSmtpHostDraft('other.smtp.com');
    state.setSmtpPasswordDraft('secret');
    state.setKindleEmailDraft('other@kindle.com');
    state.setSendTimeDraft('12:00');
    solid.flush();
    expect(state.hasAnyUnsavedChanges()).toBe(true);

    state.resetSectionDraft('articles');
    state.resetSectionDraft('extraction');
    state.resetSectionDraft('services');
    state.resetSectionDraft('kindle');
    solid.flush();

    expect(state.retentionDraft()).toBe(100);
    expect(state.providerDraft()).toBe('direct');
    expect(state.jinaKeyDraft()).toBe('');
    expect(state.browserEndpointDraft()).toBe('');
    expect(state.smtpHostDraft()).toBe('smtp.example.com');
    expect(state.smtpPasswordDraft()).toBe('');
    expect(state.kindleEmailDraft()).toBe('kindle@example.com');
    expect(state.sendTimeDraft()).toBe('08:00');
    expect(state.hasAnyUnsavedChanges()).toBe(false);
  });
});

describe('save guard', () => {
  it('allows only one save at a time', async () => {
    await load();
    state.setRetentionDraft(50);
    solid.flush();

    const slow = pending();
    const saving = state.saveRetention();
    solid.flush();
    expect(state.isSaving()).toBe(true);
    expect(state.savingAction()).toBe('retention');

    await expect(state.saveProvider()).resolves.toBe(false);
    expect(fetchCount()).toBe(3);

    slow.resolve(noContent());
    await saving;
    solid.flush();
    expect(state.isSaving()).toBe(false);
  });
});

describe('mounted draft ownership', () => {
  it('disposes secret drafts on unmount and never retains secrets across mounts', async () => {
    await load();
    state.setJinaKeyDraft('jina-secret');
    state.setBrowserEndpointDraft('http://browser:9222');
    state.setSmtpPasswordDraft('smtp-secret');
    solid.flush();
    expect(state.hasAnyUnsavedChanges()).toBe(true);

    disposeDrafts?.();
    disposeDrafts = undefined;
    solid.flush();

    expect(state.jinaKeyDraft()).toBe('');
    expect(state.browserEndpointDraft()).toBe('');
    expect(state.smtpPasswordDraft()).toBe('');
    expect(state.hasAnyUnsavedChanges()).toBe(false);

    state.setJinaKeyDraft('should-not-persist');
    expect(state.jinaKeyDraft()).toBe('');

    disposeDrafts = state.mountSettingsDrafts();
    solid.flush();
    expect(state.retentionDraft()).toBe(100);
    expect(state.smtpHostDraft()).toBe('smtp.example.com');
    expect(state.jinaKeyDraft()).toBe('');
    expect(state.browserEndpointDraft()).toBe('');
    expect(state.smtpPasswordDraft()).toBe('');
  });
});
