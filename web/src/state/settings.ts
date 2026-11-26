/**
 * Settings state (`SET-VAL-1`, `SET-VAL-2`, `SET-VAL-3`): loaded settings, dirty tracking,
 * derived service availability, and the retention/provider saves. External services live in
 * `settings-services.ts`; Kindle delivery lives in `settings-kindle.ts`.
 */

import { flush, type StoreSetter } from 'solid-js';
import type { Settings } from '../api';
import { kindleApi, settingsApi } from '../api';
import { t } from '../i18n';
import { showToast } from '../ui';
import { sessionGeneration } from './session';
import type { SettingsDrafts, SettingsSection } from './settings-store';
import {
  isCurrentKindleSendsGeneration,
  kindleDraftsOf,
  loadingSettings,
  nextKindleSendsGeneration,
  runSave,
  savingAction,
  setKindleRunning,
  setKindleSends,
  setLoadingSettings,
  setSettings,
  settings,
  toastSettingsError,
} from './settings-store';

export type { SettingsDrafts, SettingsSection } from './settings-store';
export {
  clearSecretDrafts,
  draftsFromSettings,
  kindleRunning,
  kindleSending,
  kindleSends,
  savingAction,
  settings,
} from './settings-store';

const smtpDraftsOf = (
  smtp: Settings['smtp'] | undefined
): Pick<
  SettingsDrafts,
  | 'smtpSenderEmail'
  | 'smtpHost'
  | 'smtpPort'
  | 'smtpSecurity'
  | 'smtpUser'
  | 'smtpPassword'
> => ({
  smtpSenderEmail: smtp?.senderEmail ?? '',
  smtpHost: smtp?.host ?? '',
  smtpPort: smtp?.port ?? 0,
  smtpSecurity: smtp?.security ?? 'tls',
  smtpUser: smtp?.user ?? '',
  // `SET-VAL-3`: secrets are never returned, so drafts start blank and blank saves preserve them.
  smtpPassword: '',
});

const sectionDraftPatch = (
  section: SettingsSection,
  loaded: Settings
): Partial<SettingsDrafts> => {
  switch (section) {
    case 'articles':
      return { retention: loaded.retention };
    case 'extraction':
      return { provider: loaded.provider };
    case 'kindle':
      return kindleDraftsOf(loaded.kindle);
    case 'services':
      return {
        jinaKey: '',
        browserEndpoint: '',
        ...smtpDraftsOf(loaded.smtp),
      };
  }
};

/**
 * `settings.md:25`: discards an unsaved section draft, restoring it from the saved settings before
 * the user switches sections.
 */
export const resetSectionDraft = (
  section: SettingsSection,
  setDrafts: StoreSetter<SettingsDrafts>,
  loaded: Settings | null = settings()
): void => {
  if (loaded === null) return;

  const patch = sectionDraftPatch(section, loaded);
  setDrafts((draft) => ({ ...draft, ...patch }));
  flush();
};

const smtpDirty = (
  drafts: SettingsDrafts,
  smtp: Settings['smtp'] | undefined
): boolean =>
  drafts.smtpSenderEmail !== (smtp?.senderEmail ?? '') ||
  drafts.smtpHost !== (smtp?.host ?? '') ||
  drafts.smtpPort !== (smtp?.port ?? 0) ||
  drafts.smtpSecurity !== (smtp?.security ?? 'tls') ||
  drafts.smtpUser !== (smtp?.user ?? '') ||
  drafts.smtpPassword.trim().length > 0;

const servicesDirty = (drafts: SettingsDrafts, loaded: Settings): boolean =>
  drafts.jinaKey.trim().length > 0 ||
  drafts.browserEndpoint.trim().length > 0 ||
  smtpDirty(drafts, loaded.smtp);

/** The schedule time and timezone only count while scheduled sending is enabled. */
const kindleDirty = (
  drafts: SettingsDrafts,
  kindle: Settings['kindle'] | undefined
): boolean => {
  const saved = kindleDraftsOf(kindle);
  if (
    drafts.kindleEmail !== saved.kindleEmail ||
    drafts.scheduleEnabled !== saved.scheduleEnabled
  ) {
    return true;
  }

  return (
    drafts.scheduleEnabled &&
    (drafts.scheduleHour !== saved.scheduleHour ||
      drafts.scheduleMinute !== saved.scheduleMinute ||
      drafts.timezone !== saved.timezone)
  );
};

/** `settings.md:25`: unsaved changes guard section switches and leaving `/settings`. */
export const isSectionDirty = (
  section: SettingsSection,
  drafts: SettingsDrafts,
  loaded: Settings | null = settings()
): boolean => {
  if (loaded === null) return false;

  switch (section) {
    case 'articles':
      return drafts.retention !== loaded.retention;
    case 'extraction':
      return drafts.provider !== loaded.provider;
    case 'kindle':
      return kindleDirty(drafts, loaded.kindle);
    case 'services':
      return servicesDirty(drafts, loaded);
  }
};

export const hasAnyUnsavedChanges = (
  drafts: SettingsDrafts,
  loaded: Settings | null = settings()
): boolean =>
  isSectionDirty('articles', drafts, loaded) ||
  isSectionDirty('extraction', drafts, loaded) ||
  isSectionDirty('kindle', drafts, loaded) ||
  isSectionDirty('services', drafts, loaded);

export const isSaving = (): boolean => savingAction() !== null;

export const isSettingsReady = (): boolean =>
  settings() !== null && !loadingSettings();

export const isBrowserAvailable = (): boolean =>
  settings()?.browserEndpointConfigured === true;

export const isSmtpConfigured = (): boolean => settings()?.smtp !== undefined;

export const canSendToKindle = (): boolean =>
  isSmtpConfigured() && settings()?.kindle !== undefined;

const commitSettingSave = async (
  save: () => Promise<void>,
  patch: (current: Settings) => Settings,
  toastKey: 'settings.extractionSavedToast' | 'settings.retentionSavedToast'
): Promise<boolean> => {
  const startSession = sessionGeneration();
  try {
    await save();
    if (sessionGeneration() !== startSession) return false;

    const current = settings();
    if (current !== null) setSettings(patch(current));
    showToast(t(toastKey), 'success');
    return true;
  } catch (error) {
    if (sessionGeneration() !== startSession) return false;
    return toastSettingsError(error);
  }
};

export const saveProvider = (drafts: SettingsDrafts): Promise<boolean> =>
  runSave('provider', async () => {
    if (settings() === null) return false;
    const provider = drafts.provider;
    return commitSettingSave(
      () => settingsApi.updateProvider(provider),
      (current) => ({ ...current, provider }),
      'settings.extractionSavedToast'
    );
  });

export const saveRetention = (drafts: SettingsDrafts): Promise<boolean> =>
  runSave('retention', async () => {
    if (settings() === null) return false;
    const retention = drafts.retention;
    return commitSettingSave(
      () => settingsApi.updateRetention(retention),
      (current) => ({ ...current, retention }),
      'settings.retentionSavedToast'
    );
  });

let loadGeneration = 0;

/** Loads settings and the recent Kindle send history (`KD-LOG-1`). */
export const loadSettings = async (
  onLoaded?: (loaded: Settings) => void
): Promise<void> => {
  const startSession = sessionGeneration();
  loadGeneration += 1;
  const startLoad = loadGeneration;
  const startSendsGeneration = nextKindleSendsGeneration();

  setLoadingSettings(true);

  let loaded: Settings;
  try {
    loaded = await settingsApi.get();
  } finally {
    if (loadGeneration === startLoad && sessionGeneration() === startSession) {
      setLoadingSettings(false);
      flush();
    }
  }

  if (sessionGeneration() !== startSession || loadGeneration !== startLoad) {
    return;
  }

  setSettings(loaded);
  onLoaded?.(loaded);
  flush();

  const sends = await kindleApi.listSends();
  if (
    sessionGeneration() !== startSession ||
    loadGeneration !== startLoad ||
    !isCurrentKindleSendsGeneration(startSendsGeneration)
  ) {
    return;
  }

  setKindleSends(sends.items);
  setKindleRunning(sends.running);
  flush();
};
