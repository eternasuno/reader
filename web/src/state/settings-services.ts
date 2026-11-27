/**
 * External services settings state (`SET-SVC-1`, `SET-VAL-2`, `SET-VAL-3`): Browserless fallback
 * and SMTP mail service saves and removals.
 */

import type { StoreSetter } from 'solid-js';
import type {
  BrowserlessSettingsInput,
  BrowserlessSettingsView,
  Settings,
  SmtpSettingsInput,
  SmtpSettingsView,
} from '../api';
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
  | 'settings.browserlessSavedToast'
  | 'settings.browserlessTokenDeletedToast'
  | 'settings.browserlessDeletedToast'
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

/** `SET-VAL-3`: a blank token is omitted so the stored one is preserved. */
const browserlessInputOf = (
  drafts: SettingsDrafts
): BrowserlessSettingsInput => ({
  url: drafts.browserlessUrl.trim(),
  token:
    drafts.browserlessToken.trim().length > 0
      ? drafts.browserlessToken
      : undefined,
  residentialProxy: drafts.browserlessResidentialProxy,
});

const browserlessFromInput = (
  input: BrowserlessSettingsInput,
  previous: Settings['browserless']
): BrowserlessSettingsView => ({
  url: input.url,
  tokenConfigured:
    previous?.tokenConfigured === true || input.token !== undefined,
  residentialProxy: input.residentialProxy,
});

const savedBrowserlessDrafts = (input: BrowserlessSettingsInput) => ({
  browserlessUrl: input.url,
  browserlessToken: '',
  browserlessResidentialProxy: input.residentialProxy,
});

export const saveBrowserless = (
  drafts: SettingsDrafts,
  setDrafts: StoreSetter<SettingsDrafts>
): Promise<boolean> =>
  runSave('browserless', async () => {
    if (settings() === null) return false;
    const input = browserlessInputOf(drafts);
    return commitServiceCall(
      () => settingsApi.saveBrowserless(input),
      () => {
        const current = settings();
        if (current !== null) {
          setSettings({
            ...current,
            browserless: browserlessFromInput(input, current.browserless),
          });
        }
        setDrafts((draft) => ({ ...draft, ...savedBrowserlessDrafts(input) }));
      },
      'settings.browserlessSavedToast'
    );
  });

export const removeBrowserlessToken = (
  setDrafts: StoreSetter<SettingsDrafts>
): Promise<boolean> =>
  runSave('browserless-token', () =>
    commitServiceCall(
      () => settingsApi.deleteBrowserlessToken(),
      () => {
        const current = settings();
        if (current?.browserless !== undefined) {
          setSettings({
            ...current,
            browserless: { ...current.browserless, tokenConfigured: false },
          });
        }
        setDrafts((draft) => ({ ...draft, browserlessToken: '' }));
      },
      'settings.browserlessTokenDeletedToast'
    )
  );

export const removeBrowserless = (
  setDrafts: StoreSetter<SettingsDrafts>
): Promise<boolean> =>
  runSave('browserless', () =>
    commitServiceCall(
      () => settingsApi.deleteBrowserless(),
      () => {
        const current = settings();
        if (current !== null) {
          setSettings({ ...current, browserless: undefined });
        }
        setDrafts((draft) => ({
          ...draft,
          browserlessUrl: '',
          browserlessToken: '',
          browserlessResidentialProxy: false,
        }));
      },
      'settings.browserlessDeletedToast'
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
