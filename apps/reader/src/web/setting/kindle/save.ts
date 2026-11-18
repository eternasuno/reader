import {
  type KindleDelivery,
  type KindleInput,
  removeSmtpPassword,
  setKindle,
} from '../../api/setting';
import type { Confirm } from '../confirm';
import { given } from '../drafts';
import { run } from '../save';
import type { SettingStore } from '../store';
import { applyKindleRead } from './drafts';
import { kindleMessages as copy } from './messages';

/**
 * The writes of the `Kindle` section (settings.md SET-KINDLE): saving the whole
 * delivery, and clearing the stored SMTP password.
 */

/**
 * The delivery a save sends: every text trimmed, the port as a number, and the
 * optional SMTP user, send time and password left out when blank (SET-KINDLE-3).
 * The password itself is sent as typed and never trimmed (SET-KINDLE-2).
 */
const deliveryOf = (store: SettingStore): KindleInput => {
  const smtpUser = given(store.smtpUserDraft());
  const sendTime = given(store.sendTimeDraft());
  const smtpPassword = store.smtpPasswordDraft();

  return {
    kindleEmail: store.kindleEmailDraft().trim(),
    senderEmail: store.senderEmailDraft().trim(),
    smtpHost: store.smtpHostDraft().trim(),
    smtpPort: Number(store.smtpPortDraft()),
    smtpSecurity: store.smtpSecurityDraft(),
    ...(smtpUser === undefined ? {} : { smtpUser }),
    ...(sendTime === undefined ? {} : { sendTime }),
    ...(smtpPassword === '' ? {} : { smtpPassword }),
  };
};

/** The delivery as a read answers it: the saved values, never the password. */
const deliverySaved = (
  delivery: KindleInput,
  passwordConfigured: boolean
): KindleDelivery => {
  const { smtpPassword, ...rest } = delivery;

  return {
    ...rest,
    smtpPasswordConfigured: smtpPassword !== undefined || passwordConfigured,
  };
};

/**
 * Saves the whole delivery in one write (SET-KINDLE-3). An omitted or empty
 * password keeps the stored one; the returned values refill the drafts, so the
 * section is unchanged afterwards and the password field is empty (SET-KINDLE-2).
 */
export const saveKindle = async (store: SettingStore): Promise<void> => {
  const stored = store.setting();
  if (stored === undefined || store.saving() !== undefined) return;

  const delivery = deliveryOf(store);
  const saved = deliverySaved(
    delivery,
    stored.kindle?.smtpPasswordConfigured === true
  );
  const applied = (): void => {
    store.setSetting({ ...stored, kindle: saved });
    applyKindleRead(store, { kindle: saved });
  };

  await run(store, 'kindle', () => setKindle(delivery), applied, copy.saved);
};

/** Deletes the stored SMTP password after its confirmation (SET-KINDLE-4). */
export const clearSmtpPassword = async (
  store: SettingStore,
  confirm: Confirm
): Promise<void> => {
  const stored = store.setting();
  const kindle = stored?.kindle;
  if (stored === undefined || kindle === undefined) return;
  if (store.saving() !== undefined) return;
  if (!confirm(copy.clearPasswordConfirmation)) return;

  const applied = (): void => {
    store.setSetting({
      ...stored,
      kindle: { ...kindle, smtpPasswordConfigured: false },
    });
  };

  await run(
    store,
    'smtpPassword',
    removeSmtpPassword,
    applied,
    copy.passwordCleared
  );
};
