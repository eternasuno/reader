/**
 * Kindle delivery state (`SET-KINDLE-1`, `SET-VAL-3`, `KD-SEND-1`, `KD-LOG-1`): the Kindle/SMTP
 * section save, the stored password removal and manual sends.
 */

import { flush } from 'solid-js';
import type { KindleSettingsInput, KindleSettingsView, Settings } from '../api';
import { ApiError, kindleApi, settingsApi } from '../api';
import { t, translateErrorCode } from '../i18n';
import { showToast } from '../ui';
import {
  kindleEmailDraft,
  kindleSending,
  runSave,
  senderEmailDraft,
  sendTimeDraft,
  setKindleRunning,
  setKindleSending,
  setKindleSends,
  setSettings,
  setSmtpPasswordDraft,
  settings,
  smtpHostDraft,
  smtpPasswordDraft,
  smtpPortDraft,
  smtpSecurityDraft,
  smtpUserDraft,
} from './settings-store';

const codeOf = (error: unknown): string =>
  error instanceof ApiError ? error.code : 'RequestFailed';

const optionalText = (value: string): string | undefined =>
  value.trim().length > 0 ? value.trim() : undefined;

/** `SET-VAL-3`: a blank secret is omitted so the stored one is preserved. */
const kindleInputOf = (): KindleSettingsInput => {
  const smtpPassword = smtpPasswordDraft();

  return {
    kindleEmail: kindleEmailDraft().trim(),
    senderEmail: senderEmailDraft().trim(),
    smtpHost: smtpHostDraft().trim(),
    smtpPort: smtpPortDraft(),
    smtpSecurity: smtpSecurityDraft(),
    smtpUser: optionalText(smtpUserDraft()),
    smtpPassword: smtpPassword.length > 0 ? smtpPassword : undefined,
    sendTime: optionalText(sendTimeDraft()),
  };
};

const kindleFromInput = (
  input: KindleSettingsInput,
  previous: Settings['kindle']
): KindleSettingsView => ({
  kindleEmail: input.kindleEmail,
  senderEmail: input.senderEmail,
  smtpHost: input.smtpHost,
  smtpPort: input.smtpPort,
  smtpSecurity: input.smtpSecurity,
  smtpUser: input.smtpUser,
  sendTime: input.sendTime,
  nextSendAt: previous?.nextSendAt,
  smtpPasswordConfigured:
    previous?.smtpPasswordConfigured === true ||
    input.smtpPassword !== undefined,
});

export const saveKindle = (): Promise<boolean> =>
  runSave('kindle', async () => {
    const loaded = settings();
    if (loaded === null) return false;

    const input = kindleInputOf();
    try {
      await settingsApi.updateKindle(input);
      setSettings({ ...loaded, kindle: kindleFromInput(input, loaded.kindle) });
      setSmtpPasswordDraft('');
      showToast(String(t('settings.kindleSavedToast')), 'success');
      return true;
    } catch (error) {
      showToast(translateErrorCode(codeOf(error)), 'error');
      return false;
    }
  });

export const removeKindlePassword = (): Promise<boolean> =>
  runSave('kindle-password', async () => {
    try {
      await settingsApi.deleteKindlePassword();
      const loaded = settings();
      if (loaded !== null && loaded.kindle !== undefined) {
        setSettings({
          ...loaded,
          kindle: { ...loaded.kindle, smtpPasswordConfigured: false },
        });
      }
      setSmtpPasswordDraft('');
      showToast(String(t('settings.smtpPasswordDeletedToast')), 'success');
      return true;
    } catch (error) {
      showToast(translateErrorCode(codeOf(error)), 'error');
      return false;
    }
  });

/** `KD-SEND-1` / `KD-LOG-1`: re-reads the running state once, without polling. */
const resyncSends = async (): Promise<void> => {
  try {
    const sends = await kindleApi.listSends();
    setKindleSends(sends.items);
    setKindleRunning(sends.running);
  } catch {
    // The button state is derived from `running`; keep the previous snapshot on failure.
  }
};

/**
 * `KD-SEND-1`: enqueueing is independent of the save guard; a `409` re-syncs the running state once
 * from `GET /api/kindle/sends` instead of polling.
 */
export const triggerKindleSend = async (): Promise<boolean> => {
  if (kindleSending()) return false;

  setKindleSending(true);
  flush();

  try {
    const record = await kindleApi.sendNow();
    setKindleSends((current) => [record, ...current]);
    setKindleRunning(record.status === 'running');
    showToast(String(t('kindle.queuedToast')), 'success');
    return true;
  } catch (error) {
    const code = codeOf(error);
    if (code === 'KindleSendInProgress') await resyncSends();
    showToast(translateErrorCode(code), 'error');
    return false;
  } finally {
    setKindleSending(false);
    flush();
  }
};
