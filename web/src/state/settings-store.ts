/**
 * Shared settings store (`SET-VAL-*`, `SET-SVC-1`, `SET-KINDLE-1`, `KD-SEND-1`): loaded
 * settings, per-section drafts and the save/send guards. `settings.ts`, `settings-kindle.ts`, and
 * `settings-services.ts` read and write it through these accessors, keeping modules cycle-free.
 */

import { createSignal, flush } from 'solid-js';
import type {
  ExtractorProvider,
  KindleSendRecord,
  Settings,
  SMTPSecurity,
} from '../api';
import { ApiError } from '../api';
import { translateErrorCode } from '../i18n';
import { showToast } from '../ui';

export type SettingsSection = 'articles' | 'extraction' | 'kindle' | 'services';

/** `SET-VAL-1`: retention defaults to 100. */
export const DEFAULT_RETENTION = 100;

const [settings, setSettings] = createSignal<Settings | null>(null);

const [retentionDraft, setRetentionDraft] = createSignal(DEFAULT_RETENTION);
const [providerDraft, setProviderDraft] =
  createSignal<ExtractorProvider>('direct');
const [jinaKeyDraft, setJinaKeyDraft] = createSignal('');
const [browserEndpointDraft, setBrowserEndpointDraft] = createSignal('');

const [smtpSenderEmailDraft, setSmtpSenderEmailDraft] = createSignal('');
const [smtpHostDraft, setSmtpHostDraft] = createSignal('');
const [smtpPortDraft, setSmtpPortDraft] = createSignal(0);
const [smtpSecurityDraft, setSmtpSecurityDraft] =
  createSignal<SMTPSecurity>('tls');
const [smtpUserDraft, setSmtpUserDraft] = createSignal('');
const [smtpPasswordDraft, setSmtpPasswordDraft] = createSignal('');

const [kindleEmailDraft, setKindleEmailDraft] = createSignal('');
const [sendTimeDraft, setSendTimeDraft] = createSignal('');

const [savingAction, setSavingAction] = createSignal<string | null>(null);
const [kindleSending, setKindleSending] = createSignal(false);
const [kindleSends, setKindleSends] = createSignal<
  ReadonlyArray<KindleSendRecord>
>([]);
const [kindleRunning, setKindleRunning] = createSignal(false);

export {
  browserEndpointDraft,
  jinaKeyDraft,
  kindleEmailDraft,
  kindleRunning,
  kindleSending,
  kindleSends,
  providerDraft,
  retentionDraft,
  savingAction,
  sendTimeDraft,
  setBrowserEndpointDraft,
  setJinaKeyDraft,
  setKindleEmailDraft,
  setKindleRunning,
  setKindleSending,
  setKindleSends,
  setProviderDraft,
  setRetentionDraft,
  setSavingAction,
  setSendTimeDraft,
  setSettings,
  setSmtpHostDraft,
  setSmtpPasswordDraft,
  setSmtpPortDraft,
  setSmtpSecurityDraft,
  setSmtpSenderEmailDraft,
  setSmtpUserDraft,
  settings,
  smtpHostDraft,
  smtpPasswordDraft,
  smtpPortDraft,
  smtpSecurityDraft,
  smtpSenderEmailDraft,
  smtpUserDraft,
};

export const errorCodeOf = (error: unknown): string =>
  error instanceof ApiError ? error.code : 'RequestFailed';

export const toastSettingsError = (error: unknown): false => {
  showToast(translateErrorCode(errorCodeOf(error)), 'error');
  return false;
};

export const optionalText = (value: string): string | undefined =>
  value.trim().length > 0 ? value.trim() : undefined;

/** `settings.md:25`: only one save runs at a time; the guard never blocks Kindle sends. */
export const runSave = async (
  action: string,
  work: () => Promise<boolean>
): Promise<boolean> => {
  if (savingAction() !== null) return false;

  setSavingAction(action);
  flush();
  try {
    return await work();
  } finally {
    setSavingAction(null);
    flush();
  }
};
