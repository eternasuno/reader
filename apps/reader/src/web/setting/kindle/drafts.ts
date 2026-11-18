import { createSignal } from 'solid-js';
import type { KindleDelivery, Setting } from '../../api/setting';

/**
 * The drafts of the `Kindle` section (settings.md SET-KINDLE): the delivery as
 * typed and the SMTP password, which always starts empty and is never filled
 * from a read (SET-KINDLE-2).
 */

/** The security of the delivery, as the contract spells it (SET-KINDLE-1). */
export type KindleSecurity = KindleDelivery['smtpSecurity'];

/** What the form proposes when no delivery is stored (SET-KINDLE-1). */
const defaultPort = '465';
const defaultSecurity = 'tls' satisfies KindleSecurity;

/** Reads a security value off a select, ignoring anything but `starttls`. */
export const securityOf = (value: string): KindleSecurity =>
  value === 'starttls' ? 'starttls' : 'tls';

export const createKindleDrafts = () => {
  const [kindleEmailDraft, setKindleEmailDraft] = createSignal('');
  const [senderEmailDraft, setSenderEmailDraft] = createSignal('');
  const [smtpHostDraft, setSmtpHostDraft] = createSignal('');
  const [smtpPortDraft, setSmtpPortDraft] = createSignal(defaultPort);
  const [smtpSecurityDraft, setSmtpSecurityDraft] =
    createSignal<KindleSecurity>(defaultSecurity);
  const [smtpUserDraft, setSmtpUserDraft] = createSignal('');
  const [smtpPasswordDraft, setSmtpPasswordDraft] = createSignal('');
  const [sendTimeDraft, setSendTimeDraft] = createSignal('');

  return {
    kindleEmailDraft,
    setKindleEmailDraft,
    senderEmailDraft,
    setSenderEmailDraft,
    smtpHostDraft,
    setSmtpHostDraft,
    smtpPortDraft,
    setSmtpPortDraft,
    smtpSecurityDraft,
    setSmtpSecurityDraft,
    smtpUserDraft,
    setSmtpUserDraft,
    smtpPasswordDraft,
    setSmtpPasswordDraft,
    sendTimeDraft,
    setSendTimeDraft,
  };
};

export type KindleDrafts = ReturnType<typeof createKindleDrafts>;

/** What the drafts are compared with: the delivery that was read, if any. */
export type StoredKindle = Pick<Setting, 'kindle'>;

const portOf = (delivery: KindleDelivery | undefined): string =>
  delivery === undefined ? defaultPort : String(delivery.smtpPort);

/**
 * Fills the drafts from a read: the stored delivery, or the empty form with the
 * proposed port and security (settings.md Interface). The password stays empty.
 */
export const applyKindleRead = (
  drafts: KindleDrafts,
  stored: StoredKindle
): void => {
  const delivery = stored.kindle;

  drafts.setKindleEmailDraft(delivery?.kindleEmail ?? '');
  drafts.setSenderEmailDraft(delivery?.senderEmail ?? '');
  drafts.setSmtpHostDraft(delivery?.smtpHost ?? '');
  drafts.setSmtpPortDraft(portOf(delivery));
  drafts.setSmtpSecurityDraft(
    delivery === undefined ? defaultSecurity : securityOf(delivery.smtpSecurity)
  );
  drafts.setSmtpUserDraft(delivery?.smtpUser ?? '');
  drafts.setSmtpPasswordDraft('');
  drafts.setSendTimeDraft(delivery?.sendTime ?? '');
};

/** Drops the drafts after a confirmed switch or a save (settings.md Interface). */
export const discardKindleDraft = (
  drafts: KindleDrafts,
  stored: StoredKindle
): void => {
  applyKindleRead(drafts, stored);
};

/**
 * The section counts as changed when any field differs from the stored delivery
 * — or from the empty form when none is stored — or the password holds text.
 */
export const kindleChanged = (
  drafts: KindleDrafts,
  stored: StoredKindle
): boolean => {
  const delivery = stored.kindle;

  return (
    drafts.kindleEmailDraft() !== (delivery?.kindleEmail ?? '') ||
    drafts.senderEmailDraft() !== (delivery?.senderEmail ?? '') ||
    drafts.smtpHostDraft() !== (delivery?.smtpHost ?? '') ||
    drafts.smtpPortDraft() !== portOf(delivery) ||
    drafts.smtpSecurityDraft() !==
      (delivery === undefined
        ? defaultSecurity
        : securityOf(delivery.smtpSecurity)) ||
    drafts.smtpUserDraft() !== (delivery?.smtpUser ?? '') ||
    drafts.sendTimeDraft() !== (delivery?.sendTime ?? '') ||
    drafts.smtpPasswordDraft() !== ''
  );
};
