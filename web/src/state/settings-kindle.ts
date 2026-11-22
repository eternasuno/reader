/**
 * Kindle delivery state (`SET-KINDLE-1`, `KD-SEND-1`, `KD-LOG-1`): the Kindle section save and
 * manual sends.
 */

import { flush } from 'solid-js';
import type { KindleSettings, KindleSettingsView, Settings } from '../api';
import { kindleApi, settingsApi } from '../api';
import { t, translateErrorCode } from '../i18n';
import { showToast } from '../ui';
import {
  errorCodeOf,
  kindleEmailDraft,
  kindleSending,
  optionalText,
  runSave,
  sendTimeDraft,
  setKindleEmailDraft,
  setKindleRunning,
  setKindleSending,
  setKindleSends,
  setSendTimeDraft,
  setSettings,
  settings,
  toastSettingsError,
} from './settings-store';

const fallbackKindle = (
  input: KindleSettings,
  previous: Settings['kindle']
): KindleSettingsView =>
  input.sendTime !== undefined && previous?.nextSendAt !== undefined
    ? { ...input, nextSendAt: previous.nextSendAt }
    : { ...input };

const fetchSavedKindle = async (
  input: KindleSettings,
  previous: Settings['kindle']
): Promise<KindleSettingsView> => {
  try {
    const refreshed = await settingsApi.get();

    return refreshed.kindle ?? fallbackKindle(input, previous);
  } catch {
    return fallbackKindle(input, previous);
  }
};

export const saveKindle = (): Promise<boolean> =>
  runSave('kindle', async () => {
    const loaded = settings();
    if (loaded === null) return false;

    const input: KindleSettings = {
      kindleEmail: kindleEmailDraft().trim(),
      sendTime: optionalText(sendTimeDraft()),
    };

    try {
      await settingsApi.updateKindle(input);
      const kindle = await fetchSavedKindle(input, loaded.kindle);
      setSettings({ ...loaded, kindle });
      setKindleEmailDraft(input.kindleEmail);
      setSendTimeDraft(input.sendTime ?? '');
      showToast(String(t('settings.kindleSavedToast')), 'success');

      return true;
    } catch (error) {
      return toastSettingsError(error);
    }
  });

/** `KD-SEND-1` / `KD-LOG-1`: re-reads the running state and history once, without polling. */
export const refreshKindleSends = async (): Promise<void> => {
  try {
    const sends = await kindleApi.listSends();
    setKindleSends(sends.items);
    setKindleRunning(sends.running);
    flush();
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
    const code = errorCodeOf(error);
    if (code === 'KindleSendInProgress') await refreshKindleSends();
    showToast(translateErrorCode(code), 'error');

    return false;
  } finally {
    setKindleSending(false);
    flush();
  }
};
