/**
 * External services settings state (`SET-SVC-1`, `SET-VAL-2`, `SET-VAL-3`): Jina key, browser
 * extraction endpoint, and SMTP mail service saves and removals.
 */

import type { Settings, SmtpSettingsInput, SmtpSettingsView } from '../api';
import { settingsApi } from '../api';
import { t } from '../i18n';
import { showToast } from '../ui';
import {
  browserEndpointDraft,
  jinaKeyDraft,
  optionalText,
  providerDraft,
  runSave,
  setBrowserEndpointDraft,
  setJinaKeyDraft,
  setProviderDraft,
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

export const saveJinaKey = (): Promise<boolean> =>
  runSave('jina-key', async () => {
    const loaded = settings();
    if (loaded === null) return false;

    const key = jinaKeyDraft().trim();
    try {
      await settingsApi.saveJinaKey(key);
      setSettings({ ...loaded, jinaKeyConfigured: true });
      setJinaKeyDraft('');
      showToast(String(t('settings.jinaKeySavedToast')), 'success');
      return true;
    } catch (error) {
      return toastSettingsError(error);
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
      return toastSettingsError(error);
    }
  });

export const saveBrowserEndpoint = (): Promise<boolean> =>
  runSave('browser-endpoint', async () => {
    const loaded = settings();
    if (loaded === null) return false;

    const endpoint = browserEndpointDraft().trim();
    try {
      await settingsApi.saveBrowserEndpoint(endpoint);
      setSettings({ ...loaded, browserEndpointConfigured: true });
      setBrowserEndpointDraft('');
      showToast(String(t('settings.browserEndpointSavedToast')), 'success');
      return true;
    } catch (error) {
      return toastSettingsError(error);
    }
  });

const applyBrowserRemoved = (): void => {
  const loaded = settings();
  if (loaded === null) return;

  const isBrowser = loaded.provider === 'browser';
  setSettings({
    ...loaded,
    browserEndpointConfigured: false,
    provider: isBrowser ? 'direct' : loaded.provider,
  });
  if (isBrowser || providerDraft() === 'browser') {
    setProviderDraft('direct');
  }
};

export const removeBrowserEndpoint = (): Promise<boolean> =>
  runSave('browser-endpoint', async () => {
    try {
      await settingsApi.deleteBrowserEndpoint();
      applyBrowserRemoved();
      setBrowserEndpointDraft('');
      showToast(String(t('settings.browserEndpointDeletedToast')), 'success');
      return true;
    } catch (error) {
      return toastSettingsError(error);
    }
  });

/** `SET-VAL-3`: a blank password is omitted so the stored one is preserved. */
const smtpInputOf = (): SmtpSettingsInput => {
  const password = smtpPasswordDraft();
  return {
    senderEmail: smtpSenderEmailDraft().trim(),
    host: smtpHostDraft().trim(),
    port: smtpPortDraft(),
    security: smtpSecurityDraft(),
    user: optionalText(smtpUserDraft()),
    password: password.trim().length > 0 ? password : undefined,
  };
};

const smtpFromInput = (
  input: SmtpSettingsInput,
  previous: Settings['smtp']
): SmtpSettingsView => ({
  senderEmail: input.senderEmail,
  host: input.host,
  port: input.port,
  security: input.security,
  user: input.user,
  passwordConfigured:
    previous?.passwordConfigured === true || input.password !== undefined,
});

const applySavedSmtpDrafts = (input: SmtpSettingsInput): void => {
  setSmtpSenderEmailDraft(input.senderEmail);
  setSmtpHostDraft(input.host);
  setSmtpPortDraft(input.port);
  setSmtpSecurityDraft(input.security);
  setSmtpUserDraft(input.user ?? '');
  setSmtpPasswordDraft('');
};

export const saveSmtp = (): Promise<boolean> =>
  runSave('smtp', async () => {
    const loaded = settings();
    if (loaded === null) return false;

    const input = smtpInputOf();
    try {
      await settingsApi.saveSmtp(input);
      setSettings({ ...loaded, smtp: smtpFromInput(input, loaded.smtp) });
      applySavedSmtpDrafts(input);
      showToast(String(t('settings.smtpSavedToast')), 'success');
      return true;
    } catch (error) {
      return toastSettingsError(error);
    }
  });

export const removeSmtpPassword = (): Promise<boolean> =>
  runSave('smtp-password', async () => {
    try {
      await settingsApi.deleteSmtpPassword();
      const loaded = settings();
      if (loaded !== null && loaded.smtp !== undefined) {
        setSettings({
          ...loaded,
          smtp: { ...loaded.smtp, passwordConfigured: false },
        });
      }
      setSmtpPasswordDraft('');
      showToast(String(t('settings.smtpPasswordDeletedToast')), 'success');
      return true;
    } catch (error) {
      return toastSettingsError(error);
    }
  });

export const removeSmtp = (): Promise<boolean> =>
  runSave('smtp', async () => {
    try {
      await settingsApi.deleteSmtp();
      const loaded = settings();
      if (loaded !== null) {
        setSettings({ ...loaded, smtp: undefined });
      }
      setSmtpSenderEmailDraft('');
      setSmtpHostDraft('');
      setSmtpPortDraft(0);
      setSmtpSecurityDraft('tls');
      setSmtpUserDraft('');
      setSmtpPasswordDraft('');
      showToast(String(t('settings.smtpDeletedToast')), 'success');
      return true;
    } catch (error) {
      return toastSettingsError(error);
    }
  });
