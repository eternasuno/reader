import type { JSX } from '@solidjs/web';
import { Show, type StoreSetter } from 'solid-js';
import type { SMTPSecurity } from '../api';
import { t } from '../i18n';
import {
  isSaving,
  isSettingsReady,
  isSmtpConfigured,
  removeBrowserEndpoint,
  removeJinaKey,
  removeSmtp,
  removeSmtpPassword,
  type SettingsDrafts,
  saveBrowserEndpoint,
  saveJinaKey,
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

const confirmClearBrowser = (setDrafts: StoreSetter<SettingsDrafts>): void => {
  if (window.confirm(String(t('settings.clearBrowserEndpointConfirm')))) {
    void removeBrowserEndpoint(setDrafts);
  }
};

const confirmClearSmtp = (setDrafts: StoreSetter<SettingsDrafts>): void => {
  if (window.confirm(String(t('settings.clearSmtpConfirm')))) {
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

function JinaCard(props: SettingsDraftProps): JSX.Element {
  const configured = (): boolean => settings()?.jinaKeyConfigured === true;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void saveJinaKey(props.drafts, props.setDrafts);
      }}
    >
      <SettingsGroup
        title={String(t('settings.jinaHeading'))}
        aside={
          <StatusBadge on={configured()}>
            {String(
              t('settings.jinaStatus', {
                status: String(t(statusKey(configured()))),
              })
            )}
          </StatusBadge>
        }
        footer={
          <>
            <Show when={configured()}>
              <RemoveButton
                label={String(t('settings.deleteJinaKey'))}
                onClick={() => void removeJinaKey(props.setDrafts)}
              />
            </Show>
            <SaveButton
              label={String(t('settings.saveJinaKey'))}
              loading={savingAction() === 'jina-key'}
            />
          </>
        }
      >
        <SettingsRow stacked>
          <Input
            type="password"
            required
            autocomplete="off"
            label={String(t('settings.jinaKeyLabel'))}
            placeholder={String(t('settings.jinaKeyPlaceholder'))}
            value={props.drafts.jinaKey}
            disabled={controlsDisabled()}
            onInput={(event) => {
              const jinaKey = event.currentTarget.value;
              props.setDrafts((draft) => ({ ...draft, jinaKey }));
            }}
          />
        </SettingsRow>
      </SettingsGroup>
    </form>
  );
}

function BrowserCard(props: SettingsDraftProps): JSX.Element {
  const configured = (): boolean =>
    settings()?.browserEndpointConfigured === true;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void saveBrowserEndpoint(props.drafts, props.setDrafts);
      }}
    >
      <SettingsGroup
        title={String(t('settings.browserHeading'))}
        aside={
          <StatusBadge on={configured()}>
            {String(
              t('settings.browserStatus', {
                status: String(t(statusKey(configured()))),
              })
            )}
          </StatusBadge>
        }
        footer={
          <>
            <Show when={configured()}>
              <RemoveButton
                label={String(t('settings.clearBrowserEndpoint'))}
                onClick={() => confirmClearBrowser(props.setDrafts)}
              />
            </Show>
            <SaveButton
              label={String(t('settings.saveBrowserEndpoint'))}
              loading={savingAction() === 'browser-endpoint'}
            />
          </>
        }
      >
        <SettingsRow stacked>
          <Input
            type="url"
            required
            label={String(t('settings.browserEndpointLabel'))}
            placeholder={String(t('settings.browserEndpointPlaceholder'))}
            value={props.drafts.browserEndpoint}
            disabled={controlsDisabled()}
            onInput={(event) => {
              const browserEndpoint = event.currentTarget.value;
              props.setDrafts((draft) => ({ ...draft, browserEndpoint }));
            }}
          />
        </SettingsRow>
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
        label={String(t('settings.smtpHostLabel'))}
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
        label={String(t('settings.smtpPortLabel'))}
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
        label={String(t('settings.smtpSenderEmailLabel'))}
        value={props.drafts.smtpSenderEmail}
        disabled={controlsDisabled()}
        onInput={(event) => {
          const smtpSenderEmail = event.currentTarget.value;
          props.setDrafts((draft) => ({ ...draft, smtpSenderEmail }));
        }}
      />
      <Select
        label={String(t('settings.smtpSecurityLabel'))}
        value={props.drafts.smtpSecurity}
        disabled={controlsDisabled()}
        onChange={(event) => {
          const smtpSecurity = event.currentTarget.value as SMTPSecurity;
          props.setDrafts((draft) => ({ ...draft, smtpSecurity }));
        }}
      >
        <option value="tls">{String(t('settings.smtpSecurityTls'))}</option>
        <option value="starttls">
          {String(t('settings.smtpSecurityStarttls'))}
        </option>
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
        label={String(t('settings.smtpUserLabel'))}
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
        label={String(t('settings.smtpPasswordLabel'))}
        placeholder={String(t('settings.smtpPasswordPlaceholder'))}
        hint={String(
          t('settings.smtpPasswordStatus', {
            status: String(t(statusKey(settings()?.smtp?.passwordConfigured))),
          })
        )}
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
          label={String(t('settings.deleteSmtpPassword'))}
          onClick={() => void removeSmtpPassword(props.setDrafts)}
        />
      </Show>
      <Show when={isSmtpConfigured()}>
        <RemoveButton
          label={String(t('settings.clearSmtp'))}
          onClick={() => confirmClearSmtp(props.setDrafts)}
        />
      </Show>
      <SaveButton
        label={String(t('settings.saveSmtp'))}
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
        title={String(t('settings.smtpHeading'))}
        aside={
          <StatusBadge on={isSmtpConfigured()}>
            {String(
              t('settings.smtpStatus', {
                status: String(t(statusKey(isSmtpConfigured()))),
              })
            )}
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

/** `settings.md:21-24`: independent external services (Jina, browser extraction, SMTP). */
export function ServicesSection(props: SettingsDraftProps): JSX.Element {
  return (
    <div class="flex flex-col gap-6">
      <JinaCard drafts={props.drafts} setDrafts={props.setDrafts} />
      <BrowserCard drafts={props.drafts} setDrafts={props.setDrafts} />
      <SmtpCard drafts={props.drafts} setDrafts={props.setDrafts} />
    </div>
  );
}
