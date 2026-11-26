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
  runSave,
  setKindleRunning,
  setKindleSending,
  setKindleSends,
  setSettings,
  settings,
  toastSettingsError,
} from './settings-store';

/** The timezone belongs to the schedule, so it is sent only while scheduled sending is enabled. */
const kindleSettingsOf = (drafts: SettingsDrafts): KindleSettings => {
  const kindleEmail = drafts.kindleEmail.trim();

  return drafts.scheduleEnabled
    ? {
        kindleEmail,
        schedule: {
          hour: drafts.scheduleHour,
          minute: drafts.scheduleMinute,
          timezone: drafts.timezone,
        },
      }
    : { kindleEmail };
};

const isSameSchedule = (a: KindleSettings, b: KindleSettings): boolean =>
  a.schedule?.hour === b.schedule?.hour &&
  a.schedule?.minute === b.schedule?.minute &&
  a.schedule?.timezone === b.schedule?.timezone;

/** `nextSendAt` is server-computed, so it survives only when the schedule is unchanged. */
const fallbackKindle = (
  input: KindleSettings,
  previous: Settings['kindle']
): KindleSettingsView =>
  previous?.nextSendAt !== undefined && isSameSchedule(input, previous)
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
  setDrafts((draft) => ({ ...draft, kindleEmail: input.kindleEmail }));
  showToast(t('settings.kindleSavedToast'), 'success');
};

const performKindleSave = async (
  loaded: Settings,
  drafts: SettingsDrafts,
  setDrafts: StoreSetter<SettingsDrafts>
): Promise<boolean> => {
  const startSession = sessionGeneration();
  const input = kindleSettingsOf(drafts);

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
    showToast(t('kindle.queuedToast'), 'success');

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
