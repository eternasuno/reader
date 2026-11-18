import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getSetting: vi.fn(),
  setRetention: vi.fn(),
  useJinaFetcher: vi.fn(),
  useBrowserFetcher: vi.fn(),
  removeJinaKey: vi.fn(),
  setKindle: vi.fn(),
  removeSmtpPassword: vi.fn(),
}));

vi.mock('../../../src/web/api/setting', () => api);

import { ApiFailure } from '../../../src/web/api/failure';
import type { KindleDelivery } from '../../../src/web/api/setting';
import { clearSmtpPassword } from '../../../src/web/setting/kindle/save';
import { setAccountSaving } from '../../../src/web/setting/save';
import {
  createSettingStore,
  loadSetting,
} from '../../../src/web/setting/store';
import { dismissToast, toasts } from '../../../src/web/ui/toast';

/**
 * Clearing the stored SMTP password (SET-KINDLE-4): the confirmation decides,
 * nothing else of the delivery changes, and a failed removal keeps the password.
 */

const delivery: KindleDelivery = {
  kindleEmail: 'reader@kindle.com',
  senderEmail: 'me@example.com',
  smtpHost: 'smtp.example.com',
  smtpPort: 465,
  smtpSecurity: 'tls',
  sendTime: '07:30',
  smtpPasswordConfigured: true,
};

const defaults = {
  retention: 100,
  provider: 'jina' as const,
  jinaKeyConfigured: false,
  browserEndpointConfigured: false,
};

const loadedStore = async (kindle?: KindleDelivery) => {
  const store = createSettingStore();
  api.getSetting.mockResolvedValue(
    kindle === undefined ? defaults : { ...defaults, kindle }
  );
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

describe('clearing the stored password', () => {
  it('SET-KINDLE-4: confirming removes it and changes nothing else', async () => {
    const store = await loadedStore(delivery);
    api.removeSmtpPassword.mockResolvedValue(undefined);
    const confirm = vi.fn(() => true);

    await clearSmtpPassword(store, confirm);

    expect(confirm).toHaveBeenCalledWith('删除已保存的 SMTP 密码？');
    expect(api.removeSmtpPassword).toHaveBeenCalledTimes(1);
    expect(messagesOf('success')).toEqual(['SMTP 密码已删除']);
    expect(store.setting()?.kindle).toEqual({
      ...delivery,
      smtpPasswordConfigured: false,
    });
    expect(store.saving()).toBeUndefined();
  });

  it('Scenario: Cancelling the confirmation keeps the password', async () => {
    const store = await loadedStore(delivery);

    await clearSmtpPassword(store, () => false);

    expect(api.removeSmtpPassword).not.toHaveBeenCalled();
    expect(toasts()).toEqual([]);
    expect(store.setting()?.kindle?.smtpPasswordConfigured).toBe(true);
  });

  it('a failed removal keeps the password and shows the wording', async () => {
    const store = await loadedStore(delivery);
    api.removeSmtpPassword.mockRejectedValue(
      new ApiFailure('SettingRepositoryError')
    );

    await clearSmtpPassword(store, () => true);

    expect(messagesOf('error')).toEqual(['暂时无法访问设置，请稍后重试']);
    expect(store.setting()?.kindle?.smtpPasswordConfigured).toBe(true);
  });

  it('does nothing when no delivery is stored', async () => {
    const store = await loadedStore();
    const confirm = vi.fn(() => true);

    await clearSmtpPassword(store, confirm);

    expect(confirm).not.toHaveBeenCalled();
    expect(api.removeSmtpPassword).not.toHaveBeenCalled();
  });

  it('asks nothing while another write runs', async () => {
    const store = await loadedStore(delivery);
    const confirm = vi.fn(() => true);

    setAccountSaving(store, true);
    await clearSmtpPassword(store, confirm);

    expect(confirm).not.toHaveBeenCalled();
    expect(api.removeSmtpPassword).not.toHaveBeenCalled();

    setAccountSaving(store, false);
  });
});
