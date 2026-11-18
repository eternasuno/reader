import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import type { KindleDelivery } from '../../../src/web/api/setting';
import {
  createSettingStore,
  discard,
  draftChanged,
  loadSetting,
} from '../../../src/web/setting/store';

/**
 * The `Kindle` drafts of settings.md SET-KINDLE: a read fills them from the
 * stored delivery or from the empty form, the password is never read back, and
 * editing a field makes the section changed.
 */

const delivery: KindleDelivery = {
  kindleEmail: 'reader@kindle.com',
  senderEmail: 'me@example.com',
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpSecurity: 'starttls',
  smtpUser: 'me',
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

beforeEach(() => {
  vi.resetAllMocks();
});

describe('reading the Kindle delivery', () => {
  it('SET-KINDLE-5: a user who never saved the group reads the empty form', async () => {
    const store = await loadedStore();

    expect(store.setting()?.kindle).toBeUndefined();
    expect(store.kindleEmailDraft()).toBe('');
    expect(store.senderEmailDraft()).toBe('');
    expect(store.smtpHostDraft()).toBe('');
    expect(store.smtpPortDraft()).toBe('465');
    expect(store.smtpSecurityDraft()).toBe('tls');
    expect(store.smtpUserDraft()).toBe('');
    expect(store.smtpPasswordDraft()).toBe('');
    expect(store.sendTimeDraft()).toBe('');
    expect(draftChanged(store, 'kindle')).toBe(false);
  });

  it('Scenario: Saving the Kindle delivery keeps the password secret', async () => {
    const store = await loadedStore(delivery);

    expect(store.setting()?.kindle).toEqual(delivery);
    expect(store.setting()?.kindle?.smtpPasswordConfigured).toBe(true);
    expect(store.kindleEmailDraft()).toBe('reader@kindle.com');
    expect(store.senderEmailDraft()).toBe('me@example.com');
    expect(store.smtpHostDraft()).toBe('smtp.example.com');
    expect(store.smtpPortDraft()).toBe('587');
    expect(store.smtpSecurityDraft()).toBe('starttls');
    expect(store.smtpUserDraft()).toBe('me');
    expect(store.sendTimeDraft()).toBe('07:30');
    expect(store.smtpPasswordDraft()).toBe('');
  });
});

describe('the section counts as changed', () => {
  it('when a field differs from the stored delivery', async () => {
    const store = await loadedStore(delivery);

    store.setSendTimeDraft('08:00');
    expect(draftChanged(store, 'kindle')).toBe(true);

    store.setSendTimeDraft('07:30');
    expect(draftChanged(store, 'kindle')).toBe(false);

    store.setSmtpPortDraft('465');
    expect(draftChanged(store, 'kindle')).toBe(true);
  });

  it('when a field differs from the empty form and none is stored', async () => {
    const store = await loadedStore();

    store.setSmtpSecurityDraft('starttls');
    expect(draftChanged(store, 'kindle')).toBe(true);

    store.setSmtpSecurityDraft('tls');
    store.setSmtpPortDraft('587');
    expect(draftChanged(store, 'kindle')).toBe(true);
  });

  it('SET-KINDLE-2: a typed password changes the section', async () => {
    const store = await loadedStore(delivery);

    store.setSmtpPasswordDraft('secret');
    expect(draftChanged(store, 'kindle')).toBe(true);

    store.setSmtpPasswordDraft('');
    expect(draftChanged(store, 'kindle')).toBe(false);
  });
});

describe('discarding the section', () => {
  it('refills every field from storage and empties the password', async () => {
    const store = await loadedStore(delivery);

    store.setKindleEmailDraft('other@kindle.com');
    store.setSmtpPortDraft('25');
    store.setSmtpSecurityDraft('tls');
    store.setSendTimeDraft('');
    store.setSmtpPasswordDraft('typed');

    discard(store, 'kindle');

    expect(store.kindleEmailDraft()).toBe('reader@kindle.com');
    expect(store.smtpPortDraft()).toBe('587');
    expect(store.smtpSecurityDraft()).toBe('starttls');
    expect(store.sendTimeDraft()).toBe('07:30');
    expect(store.smtpPasswordDraft()).toBe('');
    expect(draftChanged(store, 'kindle')).toBe(false);
  });

  it('returns to the empty form when no delivery is stored', async () => {
    const store = await loadedStore();

    store.setKindleEmailDraft('reader@kindle.com');
    store.setSmtpPortDraft('587');
    store.setSmtpSecurityDraft('starttls');
    discard(store, 'kindle');

    expect(store.kindleEmailDraft()).toBe('');
    expect(store.smtpPortDraft()).toBe('465');
    expect(store.smtpSecurityDraft()).toBe('tls');
    expect(draftChanged(store, 'kindle')).toBe(false);
  });
});
