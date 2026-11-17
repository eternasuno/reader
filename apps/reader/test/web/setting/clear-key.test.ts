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
import { clearJinaKey, setAccountSaving } from '../../../src/web/setting/save';
import {
  createSettingStore,
  loadSetting,
} from '../../../src/web/setting/store';
import { dismissToast, toasts } from '../../../src/web/ui/toast';

/**
 * Clearing the stored Jina key (SET-KEY, SET-ENDPOINT): the confirmation decides,
 * the provider and the address are untouched, and no key stored changes nothing.
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

describe('clearing the stored key', () => {
  it('SET-KEY-1: confirming deletes the key and keeps the provider', async () => {
    const store = await loadedStore({
      provider: 'browser',
      jinaKeyConfigured: true,
      browserEndpointConfigured: true,
    });
    api.removeJinaKey.mockResolvedValue(undefined);
    const confirm = vi.fn(() => true);

    await clearJinaKey(store, confirm);

    expect(confirm).toHaveBeenCalledWith(
      '删除已保存的 Jina Key？删除后 Jina 提取将使用匿名访问。'
    );
    expect(api.removeJinaKey).toHaveBeenCalledTimes(1);
    expect(messagesOf('success')).toEqual(['Jina Key 已删除']);
    expect(store.setting()?.jinaKeyConfigured).toBe(false);
    expect(store.setting()?.provider).toBe('browser');
    expect(store.setting()?.browserEndpointConfigured).toBe(true);
    expect(store.providerDraft()).toBe('browser');
  });

  it('Scenario: Cancelling the confirmation keeps the key', async () => {
    const store = await loadedStore({ jinaKeyConfigured: true });

    await clearJinaKey(store, () => false);

    expect(api.removeJinaKey).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
    expect(store.setting()?.jinaKeyConfigured).toBe(true);
  });

  it('SET-KEY-2: clearing without a stored key changes nothing observable', async () => {
    const store = await loadedStore();
    api.removeJinaKey.mockResolvedValue(undefined);

    await clearJinaKey(store, () => true);
    await clearJinaKey(store, () => true);

    expect(store.setting()?.jinaKeyConfigured).toBe(false);
    expect(store.setting()?.provider).toBe('jina');
    expect(messagesOf('success')).toEqual([
      'Jina Key 已删除',
      'Jina Key 已删除',
    ]);
  });
});

describe('a removal that does not happen', () => {
  it('a failed removal keeps the key and shows the wording', async () => {
    const store = await loadedStore({ jinaKeyConfigured: true });
    api.removeJinaKey.mockRejectedValue(
      new ApiFailure('SettingRepositoryError')
    );

    await clearJinaKey(store, () => true);

    expect(messagesOf('error')).toEqual(['暂时无法访问设置，请稍后重试']);
    expect(store.setting()?.jinaKeyConfigured).toBe(true);
  });

  it('asks nothing while another write runs', async () => {
    const store = await loadedStore({ jinaKeyConfigured: true });
    const confirm = vi.fn(() => true);

    setAccountSaving(store, true);
    await clearJinaKey(store, confirm);

    expect(confirm).not.toHaveBeenCalled();
    expect(api.removeJinaKey).not.toHaveBeenCalled();

    setAccountSaving(store, false);
  });
});
