/**
 * Settings state (`SET-VAL-1`, `SET-VAL-2`, `SET-VAL-3`): loaded settings, per-section drafts,
 * dirty tracking, the one-save-at-a-time guard and the retention/extraction saves. Kindle delivery
 * lives in `settings-kindle.ts`.
 */

import { flush } from 'solid-js';
import type { ExtractorProvider, Settings } from '../api';
import { ApiError, kindleApi, settingsApi } from '../api';
import { t, translateErrorCode } from '../i18n';
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
  senderEmailDraft,
  sendTimeDraft,
  setBrowserEndpointDraft,
  setJinaKeyDraft,
  setKindleEmailDraft,
  setKindleRunning,
  setKindleSends,
  setProviderDraft,
  setRetentionDraft,
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
  senderEmailDraft,
  sendTimeDraft,
  setBrowserEndpointDraft,
  setJinaKeyDraft,
  setKindleEmailDraft,
  setProviderDraft,
  setRetentionDraft,
  setSenderEmailDraft,
  setSendTimeDraft,
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
} from './settings-store';

const codeOf = (error: unknown): string =>
  error instanceof ApiError ? error.code : 'RequestFailed';

const toastFailure = (error: unknown): false => {
  showToast(translateErrorCode(codeOf(error)), 'error');
  return false;
};

const applyKindleDrafts = (kindle: Settings['kindle'] | undefined): void => {
  setKindleEmailDraft(kindle?.kindleEmail ?? '');
  setSenderEmailDraft(kindle?.senderEmail ?? '');
  setSmtpHostDraft(kindle?.smtpHost ?? '');
  setSmtpPortDraft(kindle?.smtpPort ?? 0);
  setSmtpSecurityDraft(kindle?.smtpSecurity ?? 'tls');
  setSmtpUserDraft(kindle?.smtpUser ?? '');
  // `SET-VAL-3`: secrets are never returned, so drafts start blank and blank saves preserve them.
  setSmtpPasswordDraft('');
  setSendTimeDraft(kindle?.sendTime ?? '');
};

const applyDrafts = (loaded: Settings): void => {
  setRetentionDraft(loaded.retention);
  setProviderDraft(loaded.provider);
  // `SET-VAL-3`: secrets are never returned, so drafts start blank and blank saves preserve them.
  setJinaKeyDraft('');
  setBrowserEndpointDraft('');

  applyKindleDrafts(loaded.kindle);
};

/**
 * `settings.md:20`: discards an unsaved section draft, restoring it from the saved settings before
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
      setJinaKeyDraft('');
      setBrowserEndpointDraft('');
      break;
    case 'kindle':
      applyKindleDrafts(loaded.kindle);
      break;
  }

  flush();
};

const kindleDirty = (): boolean => {
  const kindle = settings()?.kindle;
  return (
    kindleEmailDraft() !== (kindle?.kindleEmail ?? '') ||
    senderEmailDraft() !== (kindle?.senderEmail ?? '') ||
    smtpHostDraft() !== (kindle?.smtpHost ?? '') ||
    smtpPortDraft() !== (kindle?.smtpPort ?? 0) ||
    smtpSecurityDraft() !== (kindle?.smtpSecurity ?? 'tls') ||
    smtpUserDraft() !== (kindle?.smtpUser ?? '') ||
    smtpPasswordDraft().length > 0 ||
    sendTimeDraft() !== (kindle?.sendTime ?? '')
  );
};

/** `settings.md:20`: unsaved changes guard section switches and leaving `/settings`. */
export const isSectionDirty = (section: SettingsSection): boolean => {
  const loaded = settings();
  if (loaded === null) return false;

  switch (section) {
    case 'articles':
      return retentionDraft() !== loaded.retention;
    case 'extraction':
      return (
        providerDraft() !== loaded.provider ||
        jinaKeyDraft().trim().length > 0 ||
        browserEndpointDraft().trim().length > 0
      );
    case 'kindle':
      return kindleDirty();
  }
};

export const hasAnyUnsavedChanges = (): boolean =>
  isSectionDirty('articles') ||
  isSectionDirty('extraction') ||
  isSectionDirty('kindle');

export const isSaving = (): boolean => savingAction() !== null;

const saveFetcherRequest = async (
  provider: ExtractorProvider,
  jinaKey: string,
  browserEndpoint: string
): Promise<void> => {
  switch (provider) {
    case 'direct':
      await settingsApi.setFetcherDirect();
      return;
    case 'jina':
      await settingsApi.setFetcherJina(
        jinaKey.length > 0 ? jinaKey : undefined
      );
      return;
    case 'browser':
      await settingsApi.setFetcherBrowser(
        browserEndpoint.length > 0 ? browserEndpoint : undefined
      );
  }
};

const applyExtractionSaved = (
  loaded: Settings,
  provider: ExtractorProvider,
  jinaKey: string,
  browserEndpoint: string
): void => {
  setSettings({
    ...loaded,
    provider,
    jinaKeyConfigured:
      loaded.jinaKeyConfigured || (provider === 'jina' && jinaKey.length > 0),
    browserEndpointConfigured:
      loaded.browserEndpointConfigured ||
      (provider === 'browser' && browserEndpoint.length > 0),
  });
  setJinaKeyDraft('');
  setBrowserEndpointDraft('');
};

/** `SET-VAL-2`: saves the provider and only the secret the user actually typed. */
export const saveExtraction = (): Promise<boolean> =>
  runSave('extraction', async () => {
    const loaded = settings();
    if (loaded === null) return false;

    const provider = providerDraft();
    const jinaKey = jinaKeyDraft().trim();
    const browserEndpoint = browserEndpointDraft().trim();

    try {
      await saveFetcherRequest(provider, jinaKey, browserEndpoint);
      applyExtractionSaved(loaded, provider, jinaKey, browserEndpoint);
      showToast(String(t('settings.extractionSavedToast')), 'success');
      return true;
    } catch (error) {
      return toastFailure(error);
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
      return toastFailure(error);
    }
  });

export const removeJinaKey = (): Promise<boolean> =>
  runSave('jina-key', async () => {
    try {
      await settingsApi.deleteJinaKey();
      const loaded = settings();
      if (loaded !== null) setSettings({ ...loaded, jinaKeyConfigured: false });
      setJinaKeyDraft('');
      showToast(String(t('settings.jinaKeyDeletedToast')), 'success');
      return true;
    } catch (error) {
      return toastFailure(error);
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
