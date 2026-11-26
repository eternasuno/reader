import type { JSX } from '@solidjs/web';
import { createUniqueId, For, Show } from 'solid-js';
import type { KindleSendRecord } from '../api';
import { t } from '../i18n';
import {
  canSendToKindle,
  isSaving,
  isSmtpConfigured,
  kindleRunning,
  kindleSending,
  kindleSends,
  saveKindle,
  savingAction,
  triggerKindleSend,
} from '../state';
import { Button, Icon, Input, Select, SettingsGroup, SettingsRow } from '../ui';
import {
  formatTimestamp,
  HOUR_OPTIONS,
  MINUTE_OPTIONS,
  padTwoDigits,
  SEND_STATUS_CLASSES,
  SEND_STATUS_KEYS,
  type SettingsDraftProps,
  sendResultText,
  TRIGGER_KEYS,
  timezoneOptions,
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
      <span class="flex-1">{t('kindle.smtpRequiredHint')}</span>
      <Button
        variant="secondary"
        size="sm"
        disabled={isSaving()}
        onClick={props.onGoToServices}
      >
        {t('settings.goToServices')}
      </Button>
    </div>
  );
}

function ScheduleToggleRow(props: SettingsDraftProps): JSX.Element {
  const toggleId = createUniqueId();

  return (
    <SettingsRow label={t('kindle.scheduleLabel')} labelFor={toggleId}>
      <input
        id={toggleId}
        type="checkbox"
        class="toggle toggle-sm toggle-primary disabled:border-base-content/30 disabled:opacity-100"
        checked={props.drafts.scheduleEnabled}
        disabled={isSaving()}
        onChange={(event) => {
          const scheduleEnabled = event.currentTarget.checked;
          props.setDrafts((draft) => ({ ...draft, scheduleEnabled }));
        }}
      />
    </SettingsRow>
  );
}

function ScheduleTimeRow(props: SettingsDraftProps): JSX.Element {
  const zones = timezoneOptions();
  const disabled = (): boolean => isSaving() || !props.drafts.scheduleEnabled;

  return (
    <SettingsRow stacked>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-[6rem_6rem_minmax(0,1fr)]">
        <Select
          label={t('kindle.hourLabel')}
          value={props.drafts.scheduleHour}
          disabled={disabled()}
          onChange={(event) => {
            const scheduleHour = Number(event.currentTarget.value);
            props.setDrafts((draft) => ({ ...draft, scheduleHour }));
          }}
        >
          <For each={HOUR_OPTIONS}>
            {(hour) => <option value={hour}>{padTwoDigits(hour)}</option>}
          </For>
        </Select>
        <Select
          label={t('kindle.minuteLabel')}
          value={props.drafts.scheduleMinute}
          disabled={disabled()}
          onChange={(event) => {
            const scheduleMinute = Number(event.currentTarget.value);
            props.setDrafts((draft) => ({ ...draft, scheduleMinute }));
          }}
        >
          <For each={MINUTE_OPTIONS}>
            {(minute) => <option value={minute}>{padTwoDigits(minute)}</option>}
          </For>
        </Select>
        <Select
          containerClass="col-span-2 sm:col-span-1"
          label={t('kindle.timezoneLabel')}
          value={props.drafts.timezone}
          disabled={disabled()}
          onChange={(event) => {
            const timezone = event.currentTarget.value;
            props.setDrafts((draft) => ({ ...draft, timezone }));
          }}
        >
          <Show
            when={!zones.some((zone) => zone.value === props.drafts.timezone)}
          >
            <option value={props.drafts.timezone}>
              {props.drafts.timezone}
            </option>
          </Show>
          <For each={zones}>
            {(zone) => <option value={zone.value}>{zone.label}</option>}
          </For>
        </Select>
      </div>
    </SettingsRow>
  );
}

function DeliveryFields(props: SettingsDraftProps): JSX.Element {
  return (
    <>
      <SettingsRow stacked>
        <Input
          type="email"
          required
          label={t('kindle.kindleEmailLabel')}
          value={props.drafts.kindleEmail}
          disabled={isSaving()}
          onInput={(event) => {
            const kindleEmail = event.currentTarget.value;
            props.setDrafts((draft) => ({ ...draft, kindleEmail }));
          }}
        />
      </SettingsRow>
      <ScheduleToggleRow drafts={props.drafts} setDrafts={props.setDrafts} />
      <ScheduleTimeRow drafts={props.drafts} setDrafts={props.setDrafts} />
    </>
  );
}

function DeliveryForm(props: SettingsDraftProps): JSX.Element {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void saveKindle(props.drafts, props.setDrafts);
      }}
    >
      <fieldset disabled={!isSmtpConfigured()}>
        <SettingsGroup
          title={t('kindle.deliveryHeading')}
          footer={
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={savingAction() === 'kindle'}
              disabled={isSaving()}
            >
              {t('kindle.saveKindle')}
            </Button>
          }
        >
          <DeliveryFields drafts={props.drafts} setDrafts={props.setDrafts} />
        </SettingsGroup>
      </fieldset>
    </form>
  );
}

/** `settings.md:20`: disabled while a send runs or before SMTP and Kindle delivery are saved. */
function SendNowGroup(): JSX.Element {
  const busy = (): boolean => kindleSending() || kindleRunning();

  return (
    <SettingsGroup title={t('kindle.manualHeading')}>
      <SettingsRow description={t('kindle.sendNowHint')}>
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
          {t(busy() ? 'kindle.sendingNow' : 'kindle.sendNow')}
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
          {t(SEND_STATUS_KEYS[props.record.status])}
        </span>
        <span class="text-xs text-base-content/60">
          {t(TRIGGER_KEYS[props.record.trigger])}
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
    <SettingsGroup title={t('kindle.recentSendsHeading')}>
      <Show
        when={kindleSends().length > 0}
        fallback={
          <p class="px-4 py-6 text-center text-sm text-base-content/60">
            {t('kindle.emptySends')}
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
export function KindleSection(
  props: SettingsDraftProps & {
    onGoToServices: () => void;
  }
): JSX.Element {
  return (
    <div class="flex flex-col gap-6">
      <Show when={!isSmtpConfigured()}>
        <SmtpRequiredBanner onGoToServices={props.onGoToServices} />
      </Show>
      <DeliveryForm drafts={props.drafts} setDrafts={props.setDrafts} />
      <SendNowGroup />
      <SendsGroup />
    </div>
  );
}
