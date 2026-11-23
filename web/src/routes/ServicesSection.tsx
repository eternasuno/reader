import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import type { SMTPSecurity } from '../api';
import { t } from '../i18n';
import {
  browserEndpointDraft,
  isSaving,
  isSettingsReady,
  isSmtpConfigured,
  jinaKeyDraft,
  removeBrowserEndpoint,
  removeJinaKey,
  removeSmtp,
  removeSmtpPassword,
  saveBrowserEndpoint,
  saveJinaKey,
  saveSmtp,
  savingAction,
  setBrowserEndpointDraft,
  setJinaKeyDraft,
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
} from '../state';
import {
  Button,
  Input,
  Select,
  SettingsGroup,
  SettingsRow,
  StatusBadge,
} from '../ui';
import { statusKey } from './settingsHelpers';

const controlsDisabled = (): boolean => isSaving() || !isSettingsReady();

const confirmClearBrowser = (): void => {
  if (window.confirm(String(t('settings.clearBrowserEndpointConfirm')))) {
    void removeBrowserEndpoint();
  }
};

const confirmClearSmtp = (): void => {
  if (window.confirm(String(t('settings.clearSmtpConfirm')))) {
    void removeSmtp();
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

function JinaCard(): JSX.Element {
  const configured = (): boolean => settings()?.jinaKeyConfigured === true;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void saveJinaKey();
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
                onClick={() => void removeJinaKey()}
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
            value={jinaKeyDraft()}
            disabled={controlsDisabled()}
            onInput={(event) => setJinaKeyDraft(event.currentTarget.value)}
          />
        </SettingsRow>
      </SettingsGroup>
    </form>
  );
}

function BrowserCard(): JSX.Element {
  const configured = (): boolean =>
    settings()?.browserEndpointConfigured === true;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void saveBrowserEndpoint();
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
                onClick={confirmClearBrowser}
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
            value={browserEndpointDraft()}
            disabled={controlsDisabled()}
            onInput={(event) =>
              setBrowserEndpointDraft(event.currentTarget.value)
            }
          />
        </SettingsRow>
      </SettingsGroup>
    </form>
  );
}

function SmtpServerFields(): JSX.Element {
  return (
    <>
      <Input
        type="text"
        required
        label={String(t('settings.smtpHostLabel'))}
        value={smtpHostDraft()}
        disabled={controlsDisabled()}
        onInput={(event) => setSmtpHostDraft(event.currentTarget.value)}
      />
      <Input
        type="number"
        required
        min={1}
        max={65535}
        class="tabular-nums"
        label={String(t('settings.smtpPortLabel'))}
        value={smtpPortDraft() === 0 ? '' : String(smtpPortDraft())}
        disabled={controlsDisabled()}
        onInput={(event) => {
          const parsed = Number.parseInt(event.currentTarget.value, 10);
          setSmtpPortDraft(Number.isNaN(parsed) ? 0 : parsed);
        }}
      />
    </>
  );
}

function SmtpSenderFields(): JSX.Element {
  return (
    <>
      <Input
        type="email"
        required
        label={String(t('settings.smtpSenderEmailLabel'))}
        value={smtpSenderEmailDraft()}
        disabled={controlsDisabled()}
        onInput={(event) => setSmtpSenderEmailDraft(event.currentTarget.value)}
      />
      <Select
        label={String(t('settings.smtpSecurityLabel'))}
        value={smtpSecurityDraft()}
        disabled={controlsDisabled()}
        onChange={(event) =>
          setSmtpSecurityDraft(event.currentTarget.value as SMTPSecurity)
        }
      >
        <option value="tls">{String(t('settings.smtpSecurityTls'))}</option>
        <option value="starttls">
          {String(t('settings.smtpSecurityStarttls'))}
        </option>
      </Select>
    </>
  );
}

function SmtpCredentialFields(): JSX.Element {
  return (
    <>
      <Input
        type="text"
        autocomplete="off"
        label={String(t('settings.smtpUserLabel'))}
        value={smtpUserDraft()}
        disabled={controlsDisabled()}
        onInput={(event) => setSmtpUserDraft(event.currentTarget.value)}
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
        value={smtpPasswordDraft()}
        disabled={controlsDisabled()}
        onInput={(event) => setSmtpPasswordDraft(event.currentTarget.value)}
      />
    </>
  );
}

function SmtpFooter(): JSX.Element {
  return (
    <>
      <Show when={settings()?.smtp?.passwordConfigured}>
        <RemoveButton
          label={String(t('settings.deleteSmtpPassword'))}
          onClick={() => void removeSmtpPassword()}
        />
      </Show>
      <Show when={isSmtpConfigured()}>
        <RemoveButton
          label={String(t('settings.clearSmtp'))}
          onClick={confirmClearSmtp}
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
function SmtpCard(): JSX.Element {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void saveSmtp();
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
        footer={<SmtpFooter />}
      >
        <SettingsRow stacked>
          <div class="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <SmtpServerFields />
          </div>
        </SettingsRow>
        <SettingsRow stacked>
          <div class="grid items-start gap-4 sm:grid-cols-2">
            <SmtpSenderFields />
          </div>
        </SettingsRow>
        <SettingsRow stacked>
          <div class="grid items-start gap-4 sm:grid-cols-2">
            <SmtpCredentialFields />
          </div>
        </SettingsRow>
      </SettingsGroup>
    </form>
  );
}

/** `settings.md:21-24`: independent external services (Jina, browser extraction, SMTP). */
export function ServicesSection(): JSX.Element {
  return (
    <div class="flex flex-col gap-6">
      <JinaCard />
      <BrowserCard />
      <SmtpCard />
    </div>
  );
}
