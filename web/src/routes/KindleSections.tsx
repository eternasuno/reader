import type { JSX } from '@solidjs/web';
import { For, Show } from 'solid-js';
import type {
  KindleSendRecord,
  KindleSettingsView,
  SMTPSecurity,
} from '../api';
import { t } from '../i18n';
import {
  isSaving,
  kindleEmailDraft,
  kindleRunning,
  kindleSending,
  kindleSends,
  removeKindlePassword,
  saveKindle,
  savingAction,
  senderEmailDraft,
  sendTimeDraft,
  setKindleEmailDraft,
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
  triggerKindleSend,
} from '../state';
import { Button, Input, Select } from '../ui';
import {
  formatTimestamp,
  SEND_STATUS_CLASSES,
  SEND_STATUS_KEYS,
  SEND_TIME_SLOTS,
  sendResultText,
  statusKey,
  TRIGGER_KEYS,
} from './settingsHelpers';

const kindle = (): KindleSettingsView | undefined => settings()?.kindle;

function AddressFields(): JSX.Element {
  return (
    <>
      <Input
        type="email"
        label={String(t('kindle.kindleEmailLabel'))}
        value={kindleEmailDraft()}
        disabled={isSaving()}
        onInput={(event) => setKindleEmailDraft(event.currentTarget.value)}
      />
      <Input
        type="email"
        label={String(t('kindle.senderEmailLabel'))}
        value={senderEmailDraft()}
        disabled={isSaving()}
        onInput={(event) => setSenderEmailDraft(event.currentTarget.value)}
      />
    </>
  );
}

function SmtpHostFields(): JSX.Element {
  return (
    <>
      <Input
        type="text"
        label={String(t('kindle.smtpHostLabel'))}
        value={smtpHostDraft()}
        disabled={isSaving()}
        onInput={(event) => setSmtpHostDraft(event.currentTarget.value)}
      />
      <Input
        type="number"
        min={1}
        max={65535}
        label={String(t('kindle.smtpPortLabel'))}
        value={String(smtpPortDraft())}
        disabled={isSaving()}
        onInput={(event) => {
          const parsed = Number.parseInt(event.currentTarget.value, 10);
          setSmtpPortDraft(Number.isNaN(parsed) ? 0 : parsed);
        }}
      />
    </>
  );
}

function SmtpSecurityField(): JSX.Element {
  return (
    <Select
      label={String(t('kindle.smtpSecurityLabel'))}
      value={smtpSecurityDraft()}
      disabled={isSaving()}
      onChange={(event) =>
        setSmtpSecurityDraft(event.currentTarget.value as SMTPSecurity)
      }
    >
      <option value="tls">{String(t('kindle.securityTls'))}</option>
      <option value="starttls">{String(t('kindle.securityStarttls'))}</option>
    </Select>
  );
}

function SmtpUserField(): JSX.Element {
  return (
    <Input
      type="text"
      autocomplete="off"
      label={String(t('kindle.smtpUserLabel'))}
      value={smtpUserDraft()}
      disabled={isSaving()}
      onInput={(event) => setSmtpUserDraft(event.currentTarget.value)}
    />
  );
}

function SmtpPasswordField(): JSX.Element {
  return (
    <div class="flex flex-col gap-2">
      <Input
        type="password"
        autocomplete="new-password"
        label={String(t('kindle.smtpPasswordLabel'))}
        placeholder={String(t('kindle.smtpPasswordPlaceholder'))}
        value={smtpPasswordDraft()}
        disabled={isSaving()}
        onInput={(event) => setSmtpPasswordDraft(event.currentTarget.value)}
      />
      <div class="flex flex-wrap items-center gap-3">
        <p class="text-xs text-base-content/60">
          {String(
            t('kindle.smtpPasswordStatus', {
              status: String(t(statusKey(kindle()?.smtpPasswordConfigured))),
            })
          )}
        </p>
        <Show when={kindle()?.smtpPasswordConfigured}>
          <Button
            variant="danger"
            size="sm"
            disabled={isSaving()}
            onClick={() => void removeKindlePassword()}
          >
            {String(t('kindle.deleteSmtpPassword'))}
          </Button>
        </Show>
      </div>
    </div>
  );
}

function SendTimeField(): JSX.Element {
  return (
    <Select
      label={String(t('kindle.sendTimeLabel'))}
      value={sendTimeDraft()}
      disabled={isSaving()}
      onChange={(event) => setSendTimeDraft(event.currentTarget.value)}
    >
      <option value="">{String(t('kindle.sendTimeNone'))}</option>
      <For each={SEND_TIME_SLOTS}>
        {(slot) => <option value={slot}>{slot}</option>}
      </For>
    </Select>
  );
}

function SaveKindleButton(): JSX.Element {
  return (
    <div>
      <Button
        variant="primary"
        loading={savingAction() === 'kindle'}
        disabled={isSaving()}
        onClick={() => void saveKindle()}
      >
        {String(t('kindle.saveKindle'))}
      </Button>
    </div>
  );
}

function SendNowButton(): JSX.Element {
  const busy = (): boolean => kindleSending() || kindleRunning();

  return (
    <div class="flex items-center justify-end border-t border-base-300 pt-4">
      <Button
        variant="secondary"
        size="sm"
        disabled={busy()}
        loading={kindleSending()}
        onClick={() => void triggerKindleSend()}
      >
        {String(t(busy() ? 'kindle.sendingNow' : 'kindle.sendNow'))}
      </Button>
    </div>
  );
}

function SendRecordRow(props: { record: KindleSendRecord }): JSX.Element {
  return (
    <li class="flex flex-col gap-0.5 py-2">
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <span class="badge badge-sm border-0 bg-base-300">
          {String(t(TRIGGER_KEYS[props.record.trigger]))}
        </span>
        <span class={SEND_STATUS_CLASSES[props.record.status]}>
          {String(t(SEND_STATUS_KEYS[props.record.status]))}
        </span>
        <span class="text-xs text-base-content/60">
          {formatTimestamp(props.record.startedAt)}
        </span>
      </div>
      <p class="text-xs text-base-content/70">{sendResultText(props.record)}</p>
    </li>
  );
}

function SendsList(): JSX.Element {
  return (
    <section class="flex flex-col gap-2">
      <h2 class="text-sm font-semibold">
        {String(t('kindle.recentSendsHeading'))}
      </h2>
      <Show
        when={kindleSends().length > 0}
        fallback={
          <p class="text-sm text-base-content/60">
            {String(t('kindle.emptySends'))}
          </p>
        }
      >
        <ul class="flex flex-col divide-y divide-base-300">
          <For each={kindleSends()}>
            {(record) => <SendRecordRow record={record} />}
          </For>
        </ul>
      </Show>
    </section>
  );
}

/** `settings.md:15`: Kindle — delivery addresses, SMTP, schedule, manual send, and history. */
export function KindleSection(): JSX.Element {
  return (
    <div class="flex max-w-xl flex-col gap-4">
      <AddressFields />
      <SmtpHostFields />
      <SmtpSecurityField />
      <SmtpUserField />
      <SmtpPasswordField />
      <SendTimeField />
      <SaveKindleButton />
      <SendNowButton />
      <SendsList />
    </div>
  );
}
