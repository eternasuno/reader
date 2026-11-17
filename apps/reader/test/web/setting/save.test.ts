import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setRetention: vi.fn(),
  useJinaFetcher: vi.fn(),
  useBrowserFetcher: vi.fn(),
  removeJinaKey: vi.fn(),
}));

vi.mock('../../../src/web/api/setting', () => api);

import { ApiFailure } from '../../../src/web/api/failure';
import {
  saveFetcher,
  saveRetention,
  setAccountSaving,
} from '../../../src/web/setting/save';
import {
  createSettingStore,
  draftChanged,
  loadSetting,
} from '../../../src/web/setting/store';
import { dismissToast, toasts } from '../../../src/web/ui/toast';

/**
 * The two write actions of the page: the retention (SET-FEED-1) and the fetcher
 * (SET-FETCH, SET-VAL-6). Each saves one request, reports it as a toast, keeps
 * what did not belong to the request and never runs twice at once.
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

const messagesOf = (kind: 'success' | 'error'): ReadonlyArray<string> =>
  toasts()
    .filter((toast) => toast.kind === kind)
    .map((toast) => toast.message);

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();

  for (const toast of toasts()) dismissToast(toast.id);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the retention', () => {
  it('SET-FEED-1: saving stores the value and shows the saved toast', async () => {
    const store = await loadedStore();
    api.setRetention.mockResolvedValue(undefined);

    store.setRetentionDraft('60');
    await saveRetention(store);

    expect(api.setRetention).toHaveBeenCalledWith(60);
    expect(messagesOf('success')).toEqual(['文章保留数量已保存']);
    expect(store.setting()?.retention).toBe(60);
    expect(store.retentionDraft()).toBe('60');
    expect(draftChanged(store, 'articles')).toBe(false);
    expect(store.saving()).toBeUndefined();
  });

  it('a rejected retention keeps the typed value and shows the wording', async () => {
    const store = await loadedStore();
    api.setRetention.mockRejectedValue(new ApiFailure('InvalidRetention'));

    store.setRetentionDraft('0');
    await saveRetention(store);

    expect(messagesOf('error')).toEqual(['保留数量必须是正整数']);
    expect(store.setting()?.retention).toBe(100);
    expect(store.retentionDraft()).toBe('0');
    expect(draftChanged(store, 'articles')).toBe(true);
  });
});

describe('the fetcher', () => {
  it('SET-FETCH-1: a typed key is trimmed, sent and then emptied', async () => {
    const store = await loadedStore();
    api.useJinaFetcher.mockResolvedValue(undefined);

    store.setJinaKeyDraft('  sk-live  ');
    await saveFetcher(store);

    expect(api.useJinaFetcher).toHaveBeenCalledWith('sk-live');
    expect(api.useBrowserFetcher).not.toHaveBeenCalled();
    expect(messagesOf('success')).toEqual(['提取设置已保存']);
    expect(store.jinaKeyDraft()).toBe('');
    expect(store.setting()?.jinaKeyConfigured).toBe(true);
    expect(store.providerDraft()).toBe('jina');
    expect(draftChanged(store, 'extraction')).toBe(false);
  });

  it('SET-VAL-6: a blank key counts as not given and keeps the stored key', async () => {
    const store = await loadedStore({ jinaKeyConfigured: true });
    api.useJinaFetcher.mockResolvedValue(undefined);

    store.setJinaKeyDraft('   ');
    await saveFetcher(store);

    expect(api.useJinaFetcher).toHaveBeenCalledWith(undefined);
    expect(store.setting()?.jinaKeyConfigured).toBe(true);
  });

  it('SET-FETCH-2: switching to the browser service stores the address', async () => {
    const store = await loadedStore({ jinaKeyConfigured: true });
    api.useBrowserFetcher.mockResolvedValue(undefined);

    store.setProviderDraft('browser');
    store.setEndpointDraft(' ws://127.0.0.1:9222 ');
    await saveFetcher(store);

    expect(api.useBrowserFetcher).toHaveBeenCalledWith('ws://127.0.0.1:9222');
    expect(api.useJinaFetcher).not.toHaveBeenCalled();
    expect(store.setting()).toMatchObject({
      provider: 'browser',
      browserEndpointConfigured: true,
      jinaKeyConfigured: true,
    });
    expect(store.endpointDraft()).toBe('');
    expect(store.providerDraft()).toBe('browser');
  });
});

describe('what a fetcher save keeps', () => {
  it('SET-FETCH-5: a typed address of the other provider stays after a failed save', async () => {
    const store = await loadedStore({ browserEndpointConfigured: true });
    api.useJinaFetcher.mockRejectedValue(
      new ApiFailure('SettingRepositoryError')
    );

    store.setProviderDraft('jina');
    store.setEndpointDraft('ws://other:9222');
    await saveFetcher(store);

    expect(api.useJinaFetcher).toHaveBeenCalledWith(undefined);
    expect(api.useBrowserFetcher).not.toHaveBeenCalled();
    expect(messagesOf('error')).toEqual(['暂时无法访问设置，请稍后重试']);
    expect(store.endpointDraft()).toBe('ws://other:9222');
    expect(store.setting()?.browserEndpointConfigured).toBe(true);
    expect(store.providerDraft()).toBe('jina');
  });

  it('SET-FETCH-3: the browser service without an address is reported', async () => {
    const store = await loadedStore();
    api.useBrowserFetcher.mockRejectedValue(
      new ApiFailure('BrowserEndpointRequired')
    );

    store.setProviderDraft('browser');
    await saveFetcher(store);

    expect(api.useBrowserFetcher).toHaveBeenCalledWith(undefined);
    expect(messagesOf('error')).toEqual(['请填写浏览器服务地址']);
    expect(store.providerDraft()).toBe('browser');
    expect(store.setting()?.provider).toBe('jina');
  });
});

describe('which provider a fetcher save marks', () => {
  it('marks only the provider it sent: the unsent one stays unconfigured', async () => {
    const store = await loadedStore();
    api.useBrowserFetcher.mockResolvedValue(undefined);

    // Neither is configured: a Jina key is typed, then the browser service is
    // saved, so only the address is sent (settings.md Interface: 提取).
    store.setJinaKeyDraft('sk-typed');
    store.setProviderDraft('browser');
    store.setEndpointDraft('ws://127.0.0.1:9222');
    await saveFetcher(store);

    expect(api.useBrowserFetcher).toHaveBeenCalledWith('ws://127.0.0.1:9222');
    expect(api.useJinaFetcher).not.toHaveBeenCalled();
    expect(store.setting()).toEqual({
      retention: 100,
      provider: 'browser',
      jinaKeyConfigured: false,
      browserEndpointConfigured: true,
    });
    expect(store.jinaKeyDraft()).toBe('sk-typed');
    expect(store.endpointDraft()).toBe('');
  });

  it('empties only the saved field, not the other provider’s draft', async () => {
    const store = await loadedStore();
    api.useBrowserFetcher.mockResolvedValue(undefined);

    store.setProviderDraft('browser');
    store.setEndpointDraft('ws://127.0.0.1:9222');
    store.setJinaKeyDraft('sk-typed');
    await saveFetcher(store);

    expect(store.endpointDraft()).toBe('');
    expect(store.jinaKeyDraft()).toBe('sk-typed');
  });
});

describe('one write at a time', () => {
  it('ignores a second save while a write runs', async () => {
    const store = await loadedStore();
    let finish: () => void = () => undefined;
    api.setRetention.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );

    store.setRetentionDraft('60');
    const saving = saveRetention(store);

    expect(store.saving()).toBe('retention');

    await saveFetcher(store);

    expect(api.useJinaFetcher).not.toHaveBeenCalled();

    finish();
    await saving;

    expect(store.saving()).toBeUndefined();
  });

  it('a password change in flight blocks the other writes', async () => {
    const store = await loadedStore();

    setAccountSaving(store, true);

    expect(store.saving()).toBe('password');

    await saveRetention(store);

    expect(api.setRetention).not.toHaveBeenCalled();

    setAccountSaving(store, false);

    expect(store.saving()).toBeUndefined();
  });
});
