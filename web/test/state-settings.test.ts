import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/api';

type StateModule = typeof import('../src/state');

let state: StateModule;
let solid: typeof import('solid-js');
let fetchMock: ReturnType<typeof vi.fn>;

const fresh = async (): Promise<void> => {
  vi.resetModules();
  solid = await import('solid-js');
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

const _queueEmpty = (): void => {
  fetchMock.mockResolvedValueOnce(noContent());
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

describe('settings load', () => {
  it('loads settings, drafts and Kindle sends', async () => {
    const loaded = makeSettings();
    queue(loaded);
    queue({ running: true, items: [] });
    await state.loadSettings();
    solid.flush();

    expect(state.settings()?.retention).toBe(100);
    expect(state.retentionDraft()).toBe(100);
    expect(state.providerDraft()).toBe('direct');
    expect(state.jinaKeyDraft()).toBe('');
    expect(state.browserEndpointDraft()).toBe('');
    expect(state.kindleEmailDraft()).toBe('kindle@example.com');
    expect(state.smtpPortDraft()).toBe(587);
    expect(state.smtpSecurityDraft()).toBe('starttls');
    expect(state.sendTimeDraft()).toBe('08:00');
    expect(state.kindleRunning()).toBe(true);
    expect(state.isSaving()).toBe(false);
    expect(state.hasAnyUnsavedChanges()).toBe(false);
  });
});

describe('dirty tracking', () => {
  it('tracks per-section dirty state', async () => {
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
    state.setJinaKeyDraft('   ');
    solid.flush();
    expect(state.isSectionDirty('extraction')).toBe(false);
    state.setJinaKeyDraft('key');
    solid.flush();
    expect(state.isSectionDirty('extraction')).toBe(true);
    state.setJinaKeyDraft('');
    state.setBrowserEndpointDraft('http://browser:9222');
    solid.flush();
    expect(state.isSectionDirty('extraction')).toBe(true);

    state.setKindleEmailDraft('other@kindle.com');
    solid.flush();
    expect(state.isSectionDirty('kindle')).toBe(true);
    state.setKindleEmailDraft('kindle@example.com');
    state.setSmtpPasswordDraft('secret');
    solid.flush();
    expect(state.isSectionDirty('kindle')).toBe(true);
  });
});

describe('draft reset', () => {
  it('resets a discarded section draft from the saved settings', async () => {
    await load();

    state.setRetentionDraft(25);
    state.setProviderDraft('jina');
    state.setJinaKeyDraft('secret');
    state.setKindleEmailDraft('other@kindle.com');
    state.setSmtpPasswordDraft('secret');
    solid.flush();
    expect(state.hasAnyUnsavedChanges()).toBe(true);

    state.resetSectionDraft('articles');
    state.resetSectionDraft('extraction');
    state.resetSectionDraft('kindle');
    solid.flush();

    expect(state.retentionDraft()).toBe(100);
    expect(state.providerDraft()).toBe('direct');
    expect(state.jinaKeyDraft()).toBe('');
    expect(state.kindleEmailDraft()).toBe('kindle@example.com');
    expect(state.smtpPasswordDraft()).toBe('');
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

    await expect(state.saveExtraction()).resolves.toBe(false);
    expect(fetchCount()).toBe(3);

    slow.resolve(noContent());
    await saving;
    solid.flush();
    expect(state.isSaving()).toBe(false);
  });
});
