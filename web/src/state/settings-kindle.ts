/**
 * Kindle delivery state (`SET-KINDLE-1`, `KD-SEND-1`, `KD-LOG-1`): the Kindle section save and
 * manual sends.
 */

import { flush, type StoreSetter } from 'solid-js';
import type { KindleSettings, KindleSettingsView, Settings } from '../api';
import { errorCodeOf, kindleApi, settingsApi } from '../api';
import { t, translateErrorCode } from '../i18n';
import { showToast } from '../ui';
import { sessionGeneration } from './session';
import type { SettingsDrafts } from './settings-store';
import {
  isCurrentKindleSendsGeneration,
  kindleSending,
  nextKindleSendsGeneration,
  optionalText,
  runSave,
  setKindleRunning,
  setKindleSending,
  setKindleSends,
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

const applySavedKindle = (
  kindle: KindleSettingsView,
  input: KindleSettings,
  setDrafts: StoreSetter<SettingsDrafts>
): void => {
  const current = settings();
  if (current !== null) setSettings({ ...current, kindle });
  setDrafts((draft) => ({
    ...draft,
    kindleEmail: input.kindleEmail,
    sendTime: input.sendTime ?? '',
  }));
  showToast(String(t('settings.kindleSavedToast')), 'success');
};

const performKindleSave = async (
  loaded: Settings,
  drafts: SettingsDrafts,
  setDrafts: StoreSetter<SettingsDrafts>
): Promise<boolean> => {
  const startSession = sessionGeneration();
  const input: KindleSettings = {
    kindleEmail: drafts.kindleEmail.trim(),
    sendTime: optionalText(drafts.sendTime),
  };

  try {
    await settingsApi.updateKindle(input);
    if (sessionGeneration() !== startSession) return false;

    const kindle = await fetchSavedKindle(input, loaded.kindle);
    if (sessionGeneration() !== startSession) return false;

    applySavedKindle(kindle, input, setDrafts);
    return true;
  } catch (error) {
    return sessionGeneration() === startSession
      ? toastSettingsError(error)
      : false;
  }
};

export const saveKindle = (
  drafts: SettingsDrafts,
  setDrafts: StoreSetter<SettingsDrafts>
): Promise<boolean> =>
  runSave('kindle', async () => {
    const loaded = settings();
    return loaded === null
      ? false
      : performKindleSave(loaded, drafts, setDrafts);
  });

/** `KD-SEND-1` / `KD-LOG-1`: re-reads the running state and history once, without polling. */
export const refreshKindleSends = async (): Promise<void> => {
  const startSession = sessionGeneration();
  const startGeneration = nextKindleSendsGeneration();
  try {
    const sends = await kindleApi.listSends();
    if (
      sessionGeneration() !== startSession ||
      !isCurrentKindleSendsGeneration(startGeneration)
    ) {
      return;
    }
    setKindleSends(sends.items);
    setKindleRunning(sends.running);
    flush();
  } catch {
    // The button state is derived from `running`; keep the previous snapshot on failure.
  }
};

let kindleSendToken = 0;
let activeKindleSendToken: number | null = null;

const handleKindleSendError = async (
  error: unknown,
  startSession: number
): Promise<false> => {
  if (sessionGeneration() !== startSession) return false;

  const code = errorCodeOf(error);
  if (code === 'KindleSendInProgress') await refreshKindleSends();
  if (sessionGeneration() === startSession) {
    showToast(translateErrorCode(code), 'error');
  }

  return false;
};

/**
 * `KD-SEND-1`: enqueueing is independent of the save guard; a `409` re-syncs the running state once
 * from `GET /api/kindle/sends` instead of polling.
 */
export const triggerKindleSend = async (): Promise<boolean> => {
  if (kindleSending()) return false;

  const startSession = sessionGeneration();
  kindleSendToken += 1;
  const ownerToken = kindleSendToken;
  activeKindleSendToken = ownerToken;
  setKindleSending(true);
  flush();

  try {
    const record = await kindleApi.sendNow();
    if (sessionGeneration() !== startSession) return false;

    setKindleSends((current) => [record, ...current]);
    setKindleRunning(record.status === 'running');
    showToast(String(t('kindle.queuedToast')), 'success');

    return true;
  } catch (error) {
    return handleKindleSendError(error, startSession);
  } finally {
    if (
      activeKindleSendToken === ownerToken &&
      sessionGeneration() === startSession
    ) {
      activeKindleSendToken = null;
      setKindleSending(false);
      flush();
    }
  }
};
