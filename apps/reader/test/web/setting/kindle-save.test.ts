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
import { saveKindle } from '../../../src/web/setting/kindle/save';
import { setAccountSaving } from '../../../src/web/setting/save';
import {
  createSettingStore,
  draftChanged,
  loadSetting,
} from '../../../src/web/setting/store';
import { dismissToast, toasts } from '../../../src/web/ui/toast';

/**
 * Saving the Kindle delivery (SET-KINDLE-3): one write of the whole group, the
 * blank optionals left out, the password never trimmed and never read back, and
 * a failure that keeps what was typed.
 */

type Stored = {
  readonly retention: number;
  readonly provider: 'jina' | 'browser';
  readonly jinaKeyConfigured: boolean;
  readonly browserEndpointConfigured: boolean;
  readonly kindle?: KindleDelivery;
};

const delivery: KindleDelivery = {
  kindleEmail: 'reader@kindle.com',
  senderEmail: 'me@example.com',
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpSecurity: 'starttls',
  smtpPasswordConfigured: true,
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

const filledStore = async (stored: Partial<Stored> = {}) => {
  const store = await loadedStore(stored);

  store.setKindleEmailDraft('  reader@kindle.com  ');
  store.setSenderEmailDraft(' me@example.com ');
  store.setSmtpHostDraft(' smtp.example.com ');
  store.setSmtpPortDraft('587');
  store.setSmtpSecurityDraft('starttls');

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

describe('saving the delivery', () => {
  it('SET-KINDLE-3: sends the trimmed values and leaves the blank optionals out', async () => {
    const store = await filledStore();
    api.setKindle.mockResolvedValue(undefined);

    store.setSmtpUserDraft('   ');
    store.setSendTimeDraft('');
    await saveKindle(store);

    expect(api.setKindle).toHaveBeenCalledWith({
      kindleEmail: 'reader@kindle.com',
      senderEmail: 'me@example.com',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecurity: 'starttls',
    });
    expect(messagesOf('success')).toEqual(['Kindle 设置已保存']);
    expect(store.setting()?.kindle).toEqual({
      kindleEmail: 'reader@kindle.com',
      senderEmail: 'me@example.com',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecurity: 'starttls',
      smtpPasswordConfigured: false,
    });
    expect(draftChanged(store, 'kindle')).toBe(false);
    expect(store.saving()).toBeUndefined();
  });

  it('sends the optional user and send time when they are given', async () => {
    const store = await filledStore({ kindle: delivery });
    api.setKindle.mockResolvedValue(undefined);

    store.setSmtpUserDraft(' me ');
    store.setSendTimeDraft('07:30');
    await saveKindle(store);

    expect(api.setKindle).toHaveBeenCalledWith({
      kindleEmail: 'reader@kindle.com',
      senderEmail: 'me@example.com',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecurity: 'starttls',
      smtpUser: 'me',
      sendTime: '07:30',
    });
  });
});

describe('the password of a save', () => {
  it('Scenario: Saving the Kindle delivery keeps the password secret', async () => {
    const store = await filledStore();
    api.setKindle.mockResolvedValue(undefined);

    store.setSmtpPasswordDraft(' s3cret ');
    await saveKindle(store);

    expect(api.setKindle).toHaveBeenCalledWith(
      expect.objectContaining({ smtpPassword: ' s3cret ' })
    );
    expect(store.setting()?.kindle?.smtpPasswordConfigured).toBe(true);
    expect(store.smtpPasswordDraft()).toBe('');
  });

  it('Scenario: A blank password keeps the stored one', async () => {
    const store = await filledStore({ kindle: delivery });
    api.setKindle.mockResolvedValue(undefined);

    store.setSendTimeDraft('08:00');
    await saveKindle(store);

    expect(api.setKindle.mock.calls[0]?.[0]).not.toHaveProperty('smtpPassword');
    expect(store.setting()?.kindle?.smtpPasswordConfigured).toBe(true);
  });
});

describe('a save that fails', () => {
  it('Scenario: An invalid address is rejected and keeps the drafts', async () => {
    const store = await filledStore();
    api.setKindle.mockRejectedValue(new ApiFailure('InvalidKindleSetting'));

    store.setKindleEmailDraft('kindle');
    await saveKindle(store);

    expect(messagesOf('error')).toEqual([
      'Kindle 发送设置有误，请检查填写内容',
    ]);
    expect(store.setting()?.kindle).toBeUndefined();
    expect(store.kindleEmailDraft()).toBe('kindle');
    expect(draftChanged(store, 'kindle')).toBe(true);
    expect(store.saving()).toBeUndefined();
  });
});

describe('one write at a time', () => {
  it('ignores a save while another write runs', async () => {
    const store = await filledStore();

    setAccountSaving(store, true);
    await saveKindle(store);

    expect(api.setKindle).not.toHaveBeenCalled();

    setAccountSaving(store, false);
  });

  it('marks the page as saving the Kindle section while it runs', async () => {
    const store = await filledStore();
    let finish: () => void = () => undefined;
    api.setKindle.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );

    const saving = saveKindle(store);

    expect(store.saving()).toBe('kindle');

    finish();
    await saving;

    expect(store.saving()).toBeUndefined();
  });
});
