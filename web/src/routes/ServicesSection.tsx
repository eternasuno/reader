import type { JSX } from '@solidjs/web';
import { createUniqueId, Show, type StoreSetter } from 'solid-js';
import type { SMTPSecurity } from '../api';
import { t } from '../i18n';
import {
  isSaving,
  isSettingsReady,
  isSmtpConfigured,
  removeBrowserless,
  removeBrowserlessToken,
  removeSmtp,
  removeSmtpPassword,
  type SettingsDrafts,
  saveBrowserless,
  saveSmtp,
  savingAction,
  settings,
} from '../state';
import {
  Button,
  Input,
  Select,
  SettingsGroup,
  SettingsRow,
  StatusBadge,
} from '../ui';
import { type SettingsDraftProps, statusKey } from './settingsHelpers';

const controlsDisabled = (): boolean => isSaving() || !isSettingsReady();

const confirmClearBrowserless = (
  setDrafts: StoreSetter<SettingsDrafts>
): void => {
  if (window.confirm(t('settings.clearBrowserlessConfirm'))) {
    void removeBrowserless(setDrafts);
  }
};

const confirmClearSmtp = (setDrafts: StoreSetter<SettingsDrafts>): void => {
  if (window.confirm(t('settings.clearSmtpConfirm'))) {
    void removeSmtp(setDrafts);
  }
};

/** Destructive service action: quiet error-colored text button on the footer's left. */
function RemoveButton(props: {
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button
      variant="ghost"
      size="sm"
      class="text-error hover:bg-error/10"
      disabled={controlsDisabled()}
      onClick={props.onClick}
    >
      {props.label}
    </Button>
  );
}

function SaveButton(props: { label: string; loading: boolean }): JSX.Element {
  return (
    <Button
      type="submit"
      variant="primary"
      size="sm"
      class="ml-auto"
      loading={props.loading}
      disabled={controlsDisabled()}
    >
      {props.label}
    </Button>
  );
}

const isBrowserlessConfigured = (): boolean =>
  settings()?.browserless !== undefined;

function BrowserlessProxyRow(props: SettingsDraftProps): JSX.Element {
  const toggleId = createUniqueId();

  return (
    <SettingsRow
      label={t('settings.browserlessResidentialProxyLabel')}
      labelFor={toggleId}
      description={t('settings.browserlessResidentialProxyHint')}
    >
      <input
        id={toggleId}
        type="checkbox"
        class="toggle toggle-sm toggle-primary disabled:border-base-content/30 disabled:opacity-100"
        checked={props.drafts.browserlessResidentialProxy}
        disabled={controlsDisabled()}
        onChange={(event) => {
          const browserlessResidentialProxy = event.currentTarget.checked;
          props.setDrafts((draft) => ({
            ...draft,
            browserlessResidentialProxy,
          }));
        }}
      />
    </SettingsRow>
  );
}

function BrowserlessFooter(props: {
  setDrafts: StoreSetter<SettingsDrafts>;
}): JSX.Element {
  return (
    <>
      <Show when={settings()?.browserless?.tokenConfigured}>
        <RemoveButton
          label={t('settings.deleteBrowserlessToken')}
          onClick={() => void removeBrowserlessToken(props.setDrafts)}
        />
      </Show>
      <Show when={isBrowserlessConfigured()}>
        <RemoveButton
          label={t('settings.clearBrowserless')}
          onClick={() => confirmClearBrowserless(props.setDrafts)}
        />
      </Show>
      <SaveButton
        label={t('settings.saveBrowserless')}
        loading={savingAction() === 'browserless'}
      />
    </>
  );
}

function BrowserlessCard(props: SettingsDraftProps): JSX.Element {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void saveBrowserless(props.drafts, props.setDrafts);
      }}
    >
      <SettingsGroup
        title={t('settings.browserlessHeading')}
        aside={
          <StatusBadge on={isBrowserlessConfigured()}>
            {t('settings.browserlessStatus', {
              status: String(t(statusKey(isBrowserlessConfigured()))),
            })}
          </StatusBadge>
        }
        footer={<BrowserlessFooter setDrafts={props.setDrafts} />}
      >
        <SettingsRow description={t('settings.browserlessHint')} />
        <SettingsRow stacked>
          <Input
            type="url"
            required
            label={t('settings.browserlessUrlLabel')}
            placeholder={t('settings.browserlessUrlPlaceholder')}
            value={props.drafts.browserlessUrl}
            disabled={controlsDisabled()}
            onInput={(event) => {
              const browserlessUrl = event.currentTarget.value;
              props.setDrafts((draft) => ({ ...draft, browserlessUrl }));
            }}
          />
        </SettingsRow>
        <SettingsRow stacked>
          <Input
            type="password"
            autocomplete="new-password"
            label={t('settings.browserlessTokenLabel')}
            placeholder={t('settings.browserlessTokenPlaceholder')}
            value={props.drafts.browserlessToken}
            disabled={controlsDisabled()}
            onInput={(event) => {
              const browserlessToken = event.currentTarget.value;
              props.setDrafts((draft) => ({ ...draft, browserlessToken }));
            }}
          />
        </SettingsRow>
        <BrowserlessProxyRow
          drafts={props.drafts}
          setDrafts={props.setDrafts}
        />
      </SettingsGroup>
    </form>
  );
}

function SmtpServerFields(props: SettingsDraftProps): JSX.Element {
  return (
    <>
      <Input
        type="text"
        required
        label={t('settings.smtpHostLabel')}
        value={props.drafts.smtpHost}
        disabled={controlsDisabled()}
        onInput={(event) => {
          const smtpHost = event.currentTarget.value;
          props.setDrafts((draft) => ({ ...draft, smtpHost }));
        }}
      />
      <Input
        type="number"
        required
        min={1}
        max={65535}
        class="tabular-nums"
        label={t('settings.smtpPortLabel')}
        value={props.drafts.smtpPort === 0 ? '' : String(props.drafts.smtpPort)}
        disabled={controlsDisabled()}
        onInput={(event) => {
          const parsed = Number.parseInt(event.currentTarget.value, 10);
          const smtpPort = Number.isNaN(parsed) ? 0 : parsed;
          props.setDrafts((draft) => ({ ...draft, smtpPort }));
        }}
      />
    </>
  );
}

function SmtpSenderFields(props: SettingsDraftProps): JSX.Element {
  return (
    <>
      <Input
        type="email"
        required
        label={t('settings.smtpSenderEmailLabel')}
        value={props.drafts.smtpSenderEmail}
        disabled={controlsDisabled()}
        onInput={(event) => {
          const smtpSenderEmail = event.currentTarget.value;
          props.setDrafts((draft) => ({ ...draft, smtpSenderEmail }));
        }}
      />
      <Select
        label={t('settings.smtpSecurityLabel')}
        value={props.drafts.smtpSecurity}
        disabled={controlsDisabled()}
        onChange={(event) => {
          const smtpSecurity = event.currentTarget.value as SMTPSecurity;
          props.setDrafts((draft) => ({ ...draft, smtpSecurity }));
        }}
      >
        <option value="tls">{t('settings.smtpSecurityTls')}</option>
        <option value="starttls">{t('settings.smtpSecurityStarttls')}</option>
      </Select>
    </>
  );
}

function SmtpCredentialFields(props: SettingsDraftProps): JSX.Element {
  return (
    <>
      <Input
        type="text"
        autocomplete="off"
        label={t('settings.smtpUserLabel')}
        value={props.drafts.smtpUser}
        disabled={controlsDisabled()}
        onInput={(event) => {
          const smtpUser = event.currentTarget.value;
          props.setDrafts((draft) => ({ ...draft, smtpUser }));
        }}
      />
      <Input
        type="password"
        autocomplete="new-password"
        label={t('settings.smtpPasswordLabel')}
        placeholder={t('settings.smtpPasswordPlaceholder')}
        hint={t('settings.smtpPasswordStatus', {
          status: String(t(statusKey(settings()?.smtp?.passwordConfigured))),
        })}
        value={props.drafts.smtpPassword}
        disabled={controlsDisabled()}
        onInput={(event) => {
          const smtpPassword = event.currentTarget.value;
          props.setDrafts((draft) => ({ ...draft, smtpPassword }));
        }}
      />
    </>
  );
}

function SmtpFooter(props: {
  setDrafts: StoreSetter<SettingsDrafts>;
}): JSX.Element {
  return (
    <>
      <Show when={settings()?.smtp?.passwordConfigured}>
        <RemoveButton
          label={t('settings.deleteSmtpPassword')}
          onClick={() => void removeSmtpPassword(props.setDrafts)}
        />
      </Show>
      <Show when={isSmtpConfigured()}>
        <RemoveButton
          label={t('settings.clearSmtp')}
          onClick={() => confirmClearSmtp(props.setDrafts)}
        />
      </Show>
      <SaveButton
        label={t('settings.saveSmtp')}
        loading={savingAction() === 'smtp'}
      />
    </>
  );
}

/** Two columns on wide screens: server + port, sender + security, user + password. */
function SmtpCard(props: SettingsDraftProps): JSX.Element {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void saveSmtp(props.drafts, props.setDrafts);
      }}
    >
      <SettingsGroup
        title={t('settings.smtpHeading')}
        aside={
          <StatusBadge on={isSmtpConfigured()}>
            {t('settings.smtpStatus', {
              status: String(t(statusKey(isSmtpConfigured()))),
            })}
          </StatusBadge>
        }
        footer={<SmtpFooter setDrafts={props.setDrafts} />}
      >
        <SettingsRow stacked>
          <div class="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <SmtpServerFields
              drafts={props.drafts}
              setDrafts={props.setDrafts}
            />
          </div>
        </SettingsRow>
        <SettingsRow stacked>
          <div class="grid items-start gap-4 sm:grid-cols-2">
            <SmtpSenderFields
              drafts={props.drafts}
              setDrafts={props.setDrafts}
            />
          </div>
        </SettingsRow>
        <SettingsRow stacked>
          <div class="grid items-start gap-4 sm:grid-cols-2">
            <SmtpCredentialFields
              drafts={props.drafts}
              setDrafts={props.setDrafts}
            />
          </div>
        </SettingsRow>
      </SettingsGroup>
    </form>
  );
}

/** `settings.md:21-24`: independent external services (Browserless fallback, SMTP). */
export function ServicesSection(props: SettingsDraftProps): JSX.Element {
  return (
    <div class="flex flex-col gap-6">
      <BrowserlessCard drafts={props.drafts} setDrafts={props.setDrafts} />
      <SmtpCard drafts={props.drafts} setDrafts={props.setDrafts} />
    </div>
  );
}
