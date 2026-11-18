import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setRetention: vi.fn(),
  useJinaFetcher: vi.fn(),
  useBrowserFetcher: vi.fn(),
  removeJinaKey: vi.fn(),
}));

vi.mock('../../../src/web/api/setting', () => api);

import { ApiFailure } from '../../../src/web/api/failure';
import { sectionShown } from '../../../src/web/setting/layout';
import { setAccountSaving } from '../../../src/web/setting/save';
import {
  createSettingStore,
  discard,
  draftChanged,
  loadSetting,
  reading,
} from '../../../src/web/setting/store';

/**
 * Reading the settings and the section drafts (settings.md SET-GET, SET-VAL):
 * the read fills the drafts, its failure keeps the sections hidden, and a section
 * counts as changed when its draft differs from what was read. The `账号` state
 * lives in the same store, so only a read starts the page afresh and a layout
 * change cannot reset it (settings.md Interface; the mounting itself is checked
 * in the browser).
 */

type Stored = {
  readonly retention: number;
  readonly provider: 'jina' | 'browser';
  readonly jinaKeyConfigured: boolean;
  readonly browserEndpointConfigured: boolean;
};

const defaults: Stored = {
  retention: 100,
  provider: 'jina',
  jinaKeyConfigured: false,
  browserEndpointConfigured: false,
};

const loadedStore = async (stored: Partial<Stored> = {}) => {
  const store = createSettingStore();
  api.getSetting.mockResolvedValue({ ...defaults, ...stored });
  await loadSetting(store);

  return store;
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('reading the settings', () => {
  it('SET-GET-1: a user without stored settings reads the defaults', async () => {
    const store = createSettingStore();

    expect(reading(store)).toBe(true);
    expect(store.readError()).toBe('');

    api.getSetting.mockResolvedValue(defaults);
    await loadSetting(store);

    expect(reading(store)).toBe(false);
    expect(store.setting()).toEqual(defaults);
    expect(store.retentionDraft()).toBe('100');
    expect(store.providerDraft()).toBe('jina');
    expect(store.jinaKeyDraft()).toBe('');
    expect(store.endpointDraft()).toBe('');
  });

  it('SET-VAL-4: a stored key and endpoint are reported, never read back', async () => {
    const store = await loadedStore({
      jinaKeyConfigured: true,
      browserEndpointConfigured: true,
    });

    expect(store.setting()?.jinaKeyConfigured).toBe(true);
    expect(store.setting()?.browserEndpointConfigured).toBe(true);
    expect(store.jinaKeyDraft()).toBe('');
    expect(store.endpointDraft()).toBe('');
  });

  it('Scenario: Reading the settings fails', async () => {
    const store = createSettingStore();
    api.getSetting.mockRejectedValueOnce(
      new ApiFailure('SettingRepositoryError')
    );

    await loadSetting(store);

    expect(store.readError()).toBe('暂时无法访问设置，请稍后重试');
    expect(store.setting()).toBeUndefined();
    expect(reading(store)).toBe(false);

    api.getSetting.mockResolvedValue(defaults);
    await loadSetting(store);

    expect(store.readError()).toBe('');
    expect(store.setting()).toEqual(defaults);
  });
});

describe('the 账号 state of the page', () => {
  /** What `AccountSection` reports for the password form (account.md Interface). */
  const typedAndSaving = async () => {
    const store = await loadedStore();

    store.setAccountChanged(true);
    setAccountSaving(store, true);

    return store;
  };

  it('a layout change neither forgets what was typed nor releases the write', async () => {
    const store = await typedAndSaving();

    // A layout change only says which sections are shown; nothing is dropped or reset.
    expect(sectionShown('beside', 'extraction', 'account')).toBe(false);
    expect(sectionShown('stacked', 'extraction', 'account')).toBe(true);

    expect(store.accountChanged()).toBe(true);
    expect(store.saving()).toBe('password');
  });

  it('only a read of the settings starts the page afresh', async () => {
    const store = await typedAndSaving();

    api.getSetting.mockResolvedValue(defaults);
    await loadSetting(store);

    expect(store.accountChanged()).toBe(false);
    expect(store.saving()).toBeUndefined();
  });
});

describe('a section counts as changed when its draft differs', () => {
  it('文章: the number differs from the stored retention', async () => {
    const store = await loadedStore();

    expect(draftChanged(store, 'articles')).toBe(false);

    store.setRetentionDraft('60');

    expect(draftChanged(store, 'articles')).toBe(true);

    store.setRetentionDraft('100');

    expect(draftChanged(store, 'articles')).toBe(false);
  });

  it('提取: the provider differs from the stored one', async () => {
    const store = await loadedStore();

    store.setProviderDraft('browser');

    expect(draftChanged(store, 'extraction')).toBe(true);

    store.setProviderDraft('jina');

    expect(draftChanged(store, 'extraction')).toBe(false);
  });

  it('SET-VAL-6: either secret field holding text changes the section', async () => {
    const store = await loadedStore();

    store.setJinaKeyDraft('sk-live');
    expect(draftChanged(store, 'extraction')).toBe(true);

    store.setJinaKeyDraft('   ');
    expect(draftChanged(store, 'extraction')).toBe(false);

    store.setEndpointDraft('ws://127.0.0.1:9222');
    expect(draftChanged(store, 'extraction')).toBe(true);
  });

  it('changes nothing before a read answered', async () => {
    const store = createSettingStore();

    store.setRetentionDraft('60');
    store.setJinaKeyDraft('sk-live');

    expect(draftChanged(store, 'articles')).toBe(false);
    expect(draftChanged(store, 'extraction')).toBe(false);
  });
});

describe('discarding a section returns it to what was read', () => {
  it('文章: the retention is refilled from storage', async () => {
    const store = await loadedStore({ retention: 100 });

    store.setRetentionDraft('60');
    discard(store, 'articles');

    expect(store.retentionDraft()).toBe('100');
    expect(draftChanged(store, 'articles')).toBe(false);
  });

  it('提取: the provider returns to the stored one and both fields empty', async () => {
    const store = await loadedStore({ provider: 'browser' });

    store.setProviderDraft('jina');
    store.setJinaKeyDraft('sk-live');
    store.setEndpointDraft('ws://127.0.0.1:9222');
    discard(store, 'extraction');

    expect(store.providerDraft()).toBe('browser');
    expect(store.jinaKeyDraft()).toBe('');
    expect(store.endpointDraft()).toBe('');
    expect(draftChanged(store, 'extraction')).toBe(false);
  });
});
