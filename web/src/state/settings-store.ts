/**
 * Shared settings session state (`SET-VAL-*`, `SET-SVC-1`, `SET-KINDLE-1`, `KD-SEND-1`):
 * loaded settings, Kindle send history, save/send locks, and pure draft conversion helpers.
 * Active form drafts live in a `createStore` owned by the mounted `SettingsPage`.
 */

import { createSignal, flush, type StoreSetter } from 'solid-js';
import type {
  ExtractorProvider,
  KindleSendRecord,
  Settings,
  SMTPSecurity,
} from '../api';
import { showToast } from '../ui';
import { browserTimezone } from './browserTimezone';
import { errorText } from './errorText';
import { onSessionCleared } from './session';

export type SettingsSection = 'articles' | 'extraction' | 'kindle' | 'services';

export interface SettingsDrafts {
  retention: number;
  provider: ExtractorProvider;
  jinaKey: string;
  browserEndpoint: string;
  smtpSenderEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SMTPSecurity;
  smtpUser: string;
  smtpPassword: string;
  kindleEmail: string;
  timezone: string;
  scheduleEnabled: boolean;
  scheduleHour: number;
  scheduleMinute: number;
}

export type KindleDrafts = Pick<
  SettingsDrafts,
  | 'kindleEmail'
  | 'timezone'
  | 'scheduleEnabled'
  | 'scheduleHour'
  | 'scheduleMinute'
>;

/** `SET-VAL-1`: retention defaults to 100. */
const DEFAULT_RETENTION = 100;

/** Draft-only defaults: the server stores no schedule time or timezone until scheduled sending is enabled. */
const DEFAULT_SCHEDULE_HOUR = 8;
const DEFAULT_SCHEDULE_MINUTE = 0;

export const kindleDraftsOf = (kindle: Settings['kindle']): KindleDrafts => ({
  kindleEmail: kindle?.kindleEmail ?? '',
  timezone: kindle?.schedule?.timezone ?? browserTimezone(),
  scheduleEnabled: kindle?.schedule !== undefined,
  scheduleHour: kindle?.schedule?.hour ?? DEFAULT_SCHEDULE_HOUR,
  scheduleMinute: kindle?.schedule?.minute ?? DEFAULT_SCHEDULE_MINUTE,
});

/** `SET-VAL-3`: secret fields are never returned by the API, so drafts always start blank. */
export const draftsFromSettings = (
  loaded: Settings | null
): SettingsDrafts => ({
  retention: loaded?.retention ?? DEFAULT_RETENTION,
  provider: loaded?.provider ?? 'direct',
  jinaKey: '',
  browserEndpoint: '',
  smtpSenderEmail: loaded?.smtp?.senderEmail ?? '',
  smtpHost: loaded?.smtp?.host ?? '',
  smtpPort: loaded?.smtp?.port ?? 0,
  smtpSecurity: loaded?.smtp?.security ?? 'tls',
  smtpUser: loaded?.smtp?.user ?? '',
  smtpPassword: '',
  ...kindleDraftsOf(loaded?.kindle),
});

export const clearSecretDrafts = (
  setDrafts: StoreSetter<SettingsDrafts>
): void => {
  setDrafts((draft) => ({
    ...draft,
    jinaKey: '',
    browserEndpoint: '',
    smtpPassword: '',
  }));
};

const [settings, setSettings] = createSignal<Settings | null>(null);
const [loadingSettings, setLoadingSettings] = createSignal(false);

const [savingAction, setSavingAction] = createSignal<string | null>(null);
const [kindleSending, setKindleSending] = createSignal(false);
const [kindleSends, setKindleSends] = createSignal<
  ReadonlyArray<KindleSendRecord>
>([]);
const [kindleRunning, setKindleRunning] = createSignal(false);

export {
  kindleRunning,
  kindleSending,
  kindleSends,
  loadingSettings,
  savingAction,
  setKindleRunning,
  setKindleSending,
  setKindleSends,
  setLoadingSettings,
  setSettings,
  settings,
};

let saveToken = 0;
let activeSaveToken: number | null = null;
let kindleSendsGeneration = 0;

export const nextKindleSendsGeneration = (): number => {
  kindleSendsGeneration += 1;
  return kindleSendsGeneration;
};

export const isCurrentKindleSendsGeneration = (generation: number): boolean =>
  kindleSendsGeneration === generation;

const clearSettingsState = (): void => {
  activeSaveToken = null;
  kindleSendsGeneration += 1;
  setSettings(null);
  setLoadingSettings(false);
  setSavingAction(null);
  setKindleSending(false);
  setKindleSends([]);
  setKindleRunning(false);
};

onSessionCleared(clearSettingsState);

export const toastSettingsError = (error: unknown): false => {
  showToast(errorText(error), 'error');
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

  saveToken += 1;
  const ownerToken = saveToken;
  activeSaveToken = ownerToken;
  setSavingAction(action);
  flush();
  try {
    return await work();
  } finally {
    if (activeSaveToken === ownerToken) {
      activeSaveToken = null;
      setSavingAction(null);
      flush();
    }
  }
};
