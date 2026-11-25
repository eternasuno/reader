/**
 * External services settings state (`SET-SVC-1`, `SET-VAL-2`, `SET-VAL-3`): Jina key, browser
 * extraction endpoint, and SMTP mail service saves and removals.
 */

import type { StoreSetter } from 'solid-js';
import type { Settings, SmtpSettingsInput, SmtpSettingsView } from '../api';
import { settingsApi } from '../api';
import { t } from '../i18n';
import { showToast } from '../ui';
import { sessionGeneration } from './session';
import type { SettingsDrafts } from './settings-store';
import {
  optionalText,
  runSave,
  setSettings,
  settings,
  toastSettingsError,
} from './settings-store';

type ServiceToastKey =
  | 'settings.jinaKeySavedToast'
  | 'settings.jinaKeyDeletedToast'
  | 'settings.browserEndpointSavedToast'
  | 'settings.browserEndpointDeletedToast'
  | 'settings.smtpSavedToast'
  | 'settings.smtpPasswordDeletedToast'
  | 'settings.smtpDeletedToast';

const commitServiceCall = async (
  call: () => Promise<void>,
  onSuccess: () => void,
  toastKey: ServiceToastKey
): Promise<boolean> => {
  const startSession = sessionGeneration();
  try {
    await call();
    if (sessionGeneration() !== startSession) return false;
    onSuccess();
    showToast(t(toastKey), 'success');
    return true;
  } catch (error) {
    return sessionGeneration() === startSession
      ? toastSettingsError(error)
      : false;
  }
};

export const saveJinaKey = (
  drafts: SettingsDrafts,
  setDrafts: StoreSetter<SettingsDrafts>
): Promise<boolean> =>
  runSave('jina-key', async () => {
    if (settings() === null) return false;
    const key = drafts.jinaKey.trim();
    return commitServiceCall(
      () => settingsApi.saveJinaKey(key),
      () => {
        const current = settings();
        if (current !== null)
          setSettings({ ...current, jinaKeyConfigured: true });
        setDrafts((draft) => ({ ...draft, jinaKey: '' }));
      },
      'settings.jinaKeySavedToast'
    );
  });

export const removeJinaKey = (
  setDrafts: StoreSetter<SettingsDrafts>
): Promise<boolean> =>
  runSave('jina-key', () =>
    commitServiceCall(
      () => settingsApi.deleteJinaKey(),
      () => {
        const current = settings();
        if (current !== null)
          setSettings({ ...current, jinaKeyConfigured: false });
        setDrafts((draft) => ({ ...draft, jinaKey: '' }));
      },
      'settings.jinaKeyDeletedToast'
    )
  );

export const saveBrowserEndpoint = (
  drafts: SettingsDrafts,
  setDrafts: StoreSetter<SettingsDrafts>
): Promise<boolean> =>
  runSave('browser-endpoint', async () => {
    if (settings() === null) return false;
    const endpoint = drafts.browserEndpoint.trim();
    return commitServiceCall(
      () => settingsApi.saveBrowserEndpoint(endpoint),
      () => {
        const current = settings();
        if (current !== null) {
          setSettings({ ...current, browserEndpointConfigured: true });
        }
        setDrafts((draft) => ({ ...draft, browserEndpoint: '' }));
      },
      'settings.browserEndpointSavedToast'
    );
  });

const applyBrowserRemoved = (setDrafts: StoreSetter<SettingsDrafts>): void => {
  const current = settings();
  const isBrowser = current?.provider === 'browser';
  if (current !== null) {
    setSettings({
      ...current,
      browserEndpointConfigured: false,
      provider: isBrowser ? 'direct' : current.provider,
    });
  }
  setDrafts((draft) => ({
    ...draft,
    browserEndpoint: '',
    ...(isBrowser || draft.provider === 'browser'
      ? { provider: 'direct' }
      : {}),
  }));
};

export const removeBrowserEndpoint = (
  setDrafts: StoreSetter<SettingsDrafts>
): Promise<boolean> =>
  runSave('browser-endpoint', () =>
    commitServiceCall(
      () => settingsApi.deleteBrowserEndpoint(),
      () => applyBrowserRemoved(setDrafts),
      'settings.browserEndpointDeletedToast'
    )
  );

/** `SET-VAL-3`: a blank password is omitted so the stored one is preserved. */
const smtpInputOf = (drafts: SettingsDrafts): SmtpSettingsInput => ({
  senderEmail: drafts.smtpSenderEmail.trim(),
  host: drafts.smtpHost.trim(),
  port: drafts.smtpPort,
  security: drafts.smtpSecurity,
  user: optionalText(drafts.smtpUser),
  password:
    drafts.smtpPassword.trim().length > 0 ? drafts.smtpPassword : undefined,
});

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

const savedSmtpDrafts = (input: SmtpSettingsInput) => ({
  smtpSenderEmail: input.senderEmail,
  smtpHost: input.host,
  smtpPort: input.port,
  smtpSecurity: input.security,
  smtpUser: input.user ?? '',
  smtpPassword: '',
});

export const saveSmtp = (
  drafts: SettingsDrafts,
  setDrafts: StoreSetter<SettingsDrafts>
): Promise<boolean> =>
  runSave('smtp', async () => {
    if (settings() === null) return false;
    const input = smtpInputOf(drafts);
    return commitServiceCall(
      () => settingsApi.saveSmtp(input),
      () => {
        const current = settings();
        if (current !== null) {
          setSettings({ ...current, smtp: smtpFromInput(input, current.smtp) });
        }
        setDrafts((draft) => ({ ...draft, ...savedSmtpDrafts(input) }));
      },
      'settings.smtpSavedToast'
    );
  });

export const removeSmtpPassword = (
  setDrafts: StoreSetter<SettingsDrafts>
): Promise<boolean> =>
  runSave('smtp-password', () =>
    commitServiceCall(
      () => settingsApi.deleteSmtpPassword(),
      () => {
        const current = settings();
        if (current?.smtp !== undefined) {
          setSettings({
            ...current,
            smtp: { ...current.smtp, passwordConfigured: false },
          });
        }
        setDrafts((draft) => ({ ...draft, smtpPassword: '' }));
      },
      'settings.smtpPasswordDeletedToast'
    )
  );

export const removeSmtp = (
  setDrafts: StoreSetter<SettingsDrafts>
): Promise<boolean> =>
  runSave('smtp', () =>
    commitServiceCall(
      () => settingsApi.deleteSmtp(),
      () => {
        const current = settings();
        if (current !== null) setSettings({ ...current, smtp: undefined });
        setDrafts((draft) => ({
          ...draft,
          smtpSenderEmail: '',
          smtpHost: '',
          smtpPort: 0,
          smtpSecurity: 'tls',
          smtpUser: '',
          smtpPassword: '',
        }));
      },
      'settings.smtpDeletedToast'
    )
  );
