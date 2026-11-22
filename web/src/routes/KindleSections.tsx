import type { JSX } from '@solidjs/web';
import { For, Show } from 'solid-js';
import type { KindleSendRecord } from '../api';
import { t } from '../i18n';
import {
  canSendToKindle,
  isSaving,
  isSmtpConfigured,
  kindleEmailDraft,
  kindleRunning,
  kindleSending,
  kindleSends,
  saveKindle,
  savingAction,
  sendTimeDraft,
  setKindleEmailDraft,
  setSendTimeDraft,
  triggerKindleSend,
} from '../state';
import { Button, Icon, Input, Select, SettingsGroup, SettingsRow } from '../ui';
import {
  formatTimestamp,
  SEND_STATUS_CLASSES,
  SEND_STATUS_KEYS,
  SEND_TIME_SLOTS,
  sendResultText,
  TRIGGER_KEYS,
} from './settingsHelpers';

function SmtpRequiredBanner(props: {
  onGoToServices: () => void;
}): JSX.Element {
  return (
    <div
      role="status"
      class="alert alert-warning alert-soft flex flex-wrap items-center gap-3 text-sm"
    >
      <Icon name="warning" size={18} />
      <span class="flex-1">{String(t('kindle.smtpRequiredHint'))}</span>
      <Button
        variant="secondary"
        size="sm"
        disabled={isSaving()}
        onClick={props.onGoToServices}
      >
        {String(t('settings.goToServices'))}
      </Button>
    </div>
  );
}

function DeliveryFields(): JSX.Element {
  return (
    <>
      <SettingsRow stacked>
        <Input
          type="email"
          required
          label={String(t('kindle.kindleEmailLabel'))}
          value={kindleEmailDraft()}
          disabled={isSaving()}
          onInput={(event) => setKindleEmailDraft(event.currentTarget.value)}
        />
      </SettingsRow>
      <SettingsRow stacked>
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
      </SettingsRow>
    </>
  );
}

function DeliveryForm(): JSX.Element {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void saveKindle();
      }}
    >
      <fieldset disabled={!isSmtpConfigured()}>
        <SettingsGroup
          title={String(t('kindle.deliveryHeading'))}
          footer={
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={savingAction() === 'kindle'}
              disabled={isSaving()}
            >
              {String(t('kindle.saveKindle'))}
            </Button>
          }
        >
          <DeliveryFields />
        </SettingsGroup>
      </fieldset>
    </form>
  );
}

/** `settings.md:20`: disabled while a send runs or before SMTP and Kindle delivery are saved. */
function SendNowGroup(): JSX.Element {
  const busy = (): boolean => kindleSending() || kindleRunning();

  return (
    <SettingsGroup title={String(t('kindle.manualHeading'))}>
      <SettingsRow description={String(t('kindle.sendNowHint'))}>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy() || !canSendToKindle()}
          loading={kindleSending()}
          onClick={() => void triggerKindleSend()}
        >
          <Show when={!kindleSending()}>
            <Icon name="mail" size={16} />
          </Show>
          {String(t(busy() ? 'kindle.sendingNow' : 'kindle.sendNow'))}
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
}

function SendRecordRow(props: { record: KindleSendRecord }): JSX.Element {
  return (
    <li class="flex flex-col gap-1 px-4 py-3">
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <span
          class={['badge badge-sm', SEND_STATUS_CLASSES[props.record.status]]}
        >
          {String(t(SEND_STATUS_KEYS[props.record.status]))}
        </span>
        <span class="text-xs text-base-content/60">
          {String(t(TRIGGER_KEYS[props.record.trigger]))}
        </span>
        <span class="ml-auto text-xs tabular-nums text-base-content/60">
          {formatTimestamp(props.record.startedAt)}
        </span>
      </div>
      <Show when={sendResultText(props.record)}>
        {(text) => (
          <p class="text-xs break-words text-base-content/70">{text()}</p>
        )}
      </Show>
    </li>
  );
}

function SendsGroup(): JSX.Element {
  return (
    <SettingsGroup title={String(t('kindle.recentSendsHeading'))}>
      <Show
        when={kindleSends().length > 0}
        fallback={
          <p class="px-4 py-6 text-center text-sm text-base-content/60">
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
    </SettingsGroup>
  );
}

/** `settings.md:20`: Kindle delivery address, schedule, manual send, and history. */
export function KindleSection(props: {
  onGoToServices: () => void;
}): JSX.Element {
  return (
    <div class="flex flex-col gap-6">
      <Show when={!isSmtpConfigured()}>
        <SmtpRequiredBanner onGoToServices={props.onGoToServices} />
      </Show>
      <DeliveryForm />
      <SendNowGroup />
      <SendsGroup />
    </div>
  );
}
