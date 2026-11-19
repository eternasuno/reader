/**
 * Shared settings store (`SET-VAL-*`, `KD-SEND-1`): loaded settings, per-section drafts and the
 * save/send guards. `settings.ts` and `settings-kindle.ts` read and write it through these
 * accessors, which keeps both modules free of import cycles.
 */

import { createSignal, flush } from 'solid-js';
import type {
  ExtractorProvider,
  KindleSendRecord,
  Settings,
  SMTPSecurity,
} from '../api';

export type SettingsSection = 'articles' | 'extraction' | 'kindle';

/** `SET-VAL-1`: retention defaults to 100. */
export const DEFAULT_RETENTION = 100;

const [settings, setSettings] = createSignal<Settings | null>(null);

const [retentionDraft, setRetentionDraft] = createSignal(DEFAULT_RETENTION);
const [providerDraft, setProviderDraft] =
  createSignal<ExtractorProvider>('direct');
const [jinaKeyDraft, setJinaKeyDraft] = createSignal('');
const [browserEndpointDraft, setBrowserEndpointDraft] = createSignal('');

const [kindleEmailDraft, setKindleEmailDraft] = createSignal('');
const [senderEmailDraft, setSenderEmailDraft] = createSignal('');
const [smtpHostDraft, setSmtpHostDraft] = createSignal('');
const [smtpPortDraft, setSmtpPortDraft] = createSignal(0);
const [smtpSecurityDraft, setSmtpSecurityDraft] =
  createSignal<SMTPSecurity>('tls');
const [smtpUserDraft, setSmtpUserDraft] = createSignal('');
const [smtpPasswordDraft, setSmtpPasswordDraft] = createSignal('');
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
  senderEmailDraft,
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
  setSenderEmailDraft,
  setSendTimeDraft,
  setSettings,
  setSmtpHostDraft,
  setSmtpPasswordDraft,
  setSmtpPortDraft,
  setSmtpSecurityDraft,
  setSmtpUserDraft,
  settings,
  smtpHostDraft,
  smtpPasswordDraft,
  smtpPortDraft,
  smtpSecurityDraft,
  smtpUserDraft,
};

/** `settings.md:20`: only one save runs at a time; the guard never blocks Kindle sends. */
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
