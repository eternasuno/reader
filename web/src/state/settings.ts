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
import type { SettingsSection } from './settings-store';
import {
  browserEndpointDraft,
  jinaKeyDraft,
  kindleEmailDraft,
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

export const isBrowserAvailable = (): boolean =>
  settings()?.browserEndpointConfigured === true;

export const isSmtpConfigured = (): boolean => settings()?.smtp !== undefined;

export const canSendToKindle = (): boolean =>
  isSmtpConfigured() && settings()?.kindle !== undefined;

export const saveProvider = (): Promise<boolean> =>
  runSave('provider', async () => {
    const loaded = settings();
    if (loaded === null) return false;

    const provider = providerDraft();
    try {
      await settingsApi.updateProvider(provider);
      setSettings({ ...loaded, provider });
      showToast(String(t('settings.extractionSavedToast')), 'success');
      return true;
    } catch (error) {
      return toastSettingsError(error);
    }
  });

export const saveRetention = (): Promise<boolean> =>
  runSave('retention', async () => {
    const loaded = settings();
    if (loaded === null) return false;

    const retention = retentionDraft();
    try {
      await settingsApi.updateRetention(retention);
      setSettings({ ...loaded, retention });
      showToast(String(t('settings.retentionSavedToast')), 'success');
      return true;
    } catch (error) {
      return toastSettingsError(error);
    }
  });

/** Loads settings and the recent Kindle send history (`KD-LOG-1`). */
export const loadSettings = async (): Promise<void> => {
  const loaded = await settingsApi.get();
  applyDrafts(loaded);
  setSettings(loaded);
  flush();

  const sends = await kindleApi.listSends();
  setKindleSends(sends.items);
  setKindleRunning(sends.running);
  flush();
};
