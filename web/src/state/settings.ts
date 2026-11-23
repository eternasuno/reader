/**
 * Settings state (`SET-VAL-1`, `SET-VAL-2`, `SET-VAL-3`): loaded settings, per-section drafts,
 * dirty tracking, derived service availability, and the retention/provider saves. External
 * services live in `settings-services.ts`; Kindle delivery lives in `settings-kindle.ts`.
 */

import { flush } from 'solid-js';
import type { Settings } from '../api';
import { kindleApi, settingsApi } from '../api';
import { t } from '../i18n';
import { showToast } from '../ui';
import { sessionGeneration } from './session';
import type { SettingsSection } from './settings-store';
import {
  browserEndpointDraft,
  currentDraftsOwner,
  isCurrentDraftsOwner,
  isCurrentKindleSendsGeneration,
  jinaKeyDraft,
  kindleEmailDraft,
  loadingSettings,
  nextKindleSendsGeneration,
  providerDraft,
  retentionDraft,
  runSave,
  savingAction,
  sendTimeDraft,
  setBrowserEndpointDraft,
  setJinaKeyDraft,
  setKindleEmailDraft,
  setKindleRunning,
  setKindleSends,
  setLoadingSettings,
  setProviderDraft,
  setRetentionDraft,
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
  toastSettingsError,
} from './settings-store';

export type { SettingsSection } from './settings-store';
export {
  browserEndpointDraft,
  jinaKeyDraft,
  kindleEmailDraft,
  kindleRunning,
  kindleSending,
  kindleSends,
  mountSettingsDrafts,
  providerDraft,
  retentionDraft,
  savingAction,
  sendTimeDraft,
  setBrowserEndpointDraft,
  setJinaKeyDraft,
  setKindleEmailDraft,
  setProviderDraft,
  setRetentionDraft,
  setSendTimeDraft,
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
} from './settings-store';

const applySmtpDrafts = (smtp: Settings['smtp'] | undefined): void => {
  setSmtpSenderEmailDraft(smtp?.senderEmail ?? '');
  setSmtpHostDraft(smtp?.host ?? '');
  setSmtpPortDraft(smtp?.port ?? 0);
  setSmtpSecurityDraft(smtp?.security ?? 'tls');
  setSmtpUserDraft(smtp?.user ?? '');
  // `SET-VAL-3`: secrets are never returned, so drafts start blank and blank saves preserve them.
  setSmtpPasswordDraft('');
};

const applyKindleDrafts = (kindle: Settings['kindle'] | undefined): void => {
  setKindleEmailDraft(kindle?.kindleEmail ?? '');
  setSendTimeDraft(kindle?.sendTime ?? '');
};

const applyServiceDrafts = (loaded: Settings): void => {
  // `SET-VAL-3`: secrets are never returned, so drafts start blank.
  setJinaKeyDraft('');
  setBrowserEndpointDraft('');
  applySmtpDrafts(loaded.smtp);
};

const applyDrafts = (loaded: Settings): void => {
  setRetentionDraft(loaded.retention);
  setProviderDraft(loaded.provider);
  applyServiceDrafts(loaded);
  applyKindleDrafts(loaded.kindle);
};

/**
 * `settings.md:25`: discards an unsaved section draft, restoring it from the saved settings before
 * the user switches sections.
 */
export const resetSectionDraft = (section: SettingsSection): void => {
  const loaded = settings();
  if (loaded === null) return;

  switch (section) {
    case 'articles':
      setRetentionDraft(loaded.retention);
      break;
    case 'extraction':
      setProviderDraft(loaded.provider);
      break;
    case 'kindle':
      applyKindleDrafts(loaded.kindle);
      break;
    case 'services':
      applyServiceDrafts(loaded);
      break;
  }

  flush();
};

const smtpDirty = (smtp: Settings['smtp'] | undefined): boolean =>
  smtpSenderEmailDraft() !== (smtp?.senderEmail ?? '') ||
  smtpHostDraft() !== (smtp?.host ?? '') ||
  smtpPortDraft() !== (smtp?.port ?? 0) ||
  smtpSecurityDraft() !== (smtp?.security ?? 'tls') ||
  smtpUserDraft() !== (smtp?.user ?? '') ||
  smtpPasswordDraft().trim().length > 0;

const servicesDirty = (loaded: Settings): boolean =>
  jinaKeyDraft().trim().length > 0 ||
  browserEndpointDraft().trim().length > 0 ||
  smtpDirty(loaded.smtp);

const kindleDirty = (kindle: Settings['kindle'] | undefined): boolean =>
  kindleEmailDraft() !== (kindle?.kindleEmail ?? '') ||
  sendTimeDraft() !== (kindle?.sendTime ?? '');

/** `settings.md:25`: unsaved changes guard section switches and leaving `/settings`. */
export const isSectionDirty = (section: SettingsSection): boolean => {
  if (currentDraftsOwner() === null) return false;
  const loaded = settings();
  if (loaded === null) return false;

  switch (section) {
    case 'articles':
      return retentionDraft() !== loaded.retention;
    case 'extraction':
      return providerDraft() !== loaded.provider;
    case 'kindle':
      return kindleDirty(loaded.kindle);
    case 'services':
      return servicesDirty(loaded);
  }
};

export const hasAnyUnsavedChanges = (): boolean =>
  isSectionDirty('articles') ||
  isSectionDirty('extraction') ||
  isSectionDirty('kindle') ||
  isSectionDirty('services');

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
    showToast(String(t(toastKey)), 'success');
    return true;
  } catch (error) {
    if (sessionGeneration() !== startSession) return false;
    return toastSettingsError(error);
  }
};

export const saveProvider = (): Promise<boolean> =>
  runSave('provider', async () => {
    if (settings() === null) return false;
    const provider = providerDraft();
    return commitSettingSave(
      () => settingsApi.updateProvider(provider),
      (current) => ({ ...current, provider }),
      'settings.extractionSavedToast'
    );
  });

export const saveRetention = (): Promise<boolean> =>
  runSave('retention', async () => {
    if (settings() === null) return false;
    const retention = retentionDraft();
    return commitSettingSave(
      () => settingsApi.updateRetention(retention),
      (current) => ({ ...current, retention }),
      'settings.retentionSavedToast'
    );
  });

let loadGeneration = 0;

/** Loads settings and the recent Kindle send history (`KD-LOG-1`). */
export const loadSettings = async (): Promise<void> => {
  const startSession = sessionGeneration();
  const startDrafts = currentDraftsOwner();
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

  if (
    sessionGeneration() !== startSession ||
    loadGeneration !== startLoad ||
    !isCurrentDraftsOwner(startDrafts)
  ) {
    return;
  }

  setSettings(loaded);
  if (startDrafts !== null) applyDrafts(loaded);
  flush();

  const sends = await kindleApi.listSends();
  if (
    sessionGeneration() !== startSession ||
    loadGeneration !== startLoad ||
    !isCurrentDraftsOwner(startDrafts) ||
    !isCurrentKindleSendsGeneration(startSendsGeneration)
  ) {
    return;
  }

  setKindleSends(sends.items);
  setKindleRunning(sends.running);
  flush();
};
