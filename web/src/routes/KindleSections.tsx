import type { JSX } from '@solidjs/web';
import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js';
import type { KindleLanguage, KindleSendRecord } from '../api';
import { t } from '../i18n';
import {
  browserTimezone,
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
  type TimezoneOption,
  TRIGGER_KEYS,
  timezoneGroups,
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

const ZoneOptions = (props: {
  label: string;
  options: ReadonlyArray<TimezoneOption>;
}): JSX.Element => (
  <Show when={props.options.length > 0}>
    <optgroup label={props.label}>
      <For each={props.options}>
        {(zone) => <option value={zone.value}>{zone.label}</option>}
      </For>
    </optgroup>
  </Show>
);

/**
 * `SET-KINDLE-1`: native select with the device and selected zones pinned, the curated common
 * zones, and every other zone only after `显示全部时区`.
 */
function TimezoneSelect(
  props: SettingsDraftProps & { disabled: boolean }
): JSX.Element {
  const [showAll, setShowAll] = createSignal(false);
  const device = browserTimezone();
  const groups = createMemo(() =>
    timezoneGroups(props.drafts.timezone, device, showAll())
  );

  return (
    <div class="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
      <Select
        label={t('kindle.timezoneLabel')}
        value={props.drafts.timezone}
        disabled={props.disabled}
        onChange={(event) => {
          const timezone = event.currentTarget.value;
          props.setDrafts((draft) => ({ ...draft, timezone }));
        }}
      >
        <ZoneOptions
          label={t('kindle.timezoneGroupCurrent')}
          options={groups().current}
        />
        <ZoneOptions
          label={t('kindle.timezoneGroupCommon')}
          options={groups().common}
        />
        <ZoneOptions
          label={t('kindle.timezoneGroupOthers')}
          options={groups().others}
        />
      </Select>
      <button
        type="button"
        class="link link-hover self-start text-xs text-base-content/60 disabled:pointer-events-none disabled:opacity-50"
        disabled={props.disabled}
        aria-pressed={showAll() ? 'true' : 'false'}
        onClick={() => setShowAll((value) => !value)}
      >
        {t(showAll() ? 'kindle.timezoneShowCommon' : 'kindle.timezoneShowAll')}
      </button>
    </div>
  );
}

function ScheduleTimeRow(props: SettingsDraftProps): JSX.Element {
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
        <TimezoneSelect
          drafts={props.drafts}
          setDrafts={props.setDrafts}
          disabled={disabled()}
        />
      </div>
    </SettingsRow>
  );
}

/** Each language is named in itself, independent of the interface language. */
const KINDLE_LANGUAGE_OPTIONS: ReadonlyArray<{
  value: KindleLanguage;
  label: string;
}> = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
];

/** `KD-BOOK-1`: the EPUB primary language, saved with the delivery settings. */
function LanguageRow(props: SettingsDraftProps): JSX.Element {
  return (
    <SettingsRow stacked>
      <Select
        label={t('kindle.languageLabel')}
        hint={t('kindle.languageHint')}
        class="sm:max-w-48"
        value={props.drafts.kindleLanguage}
        disabled={isSaving()}
        onChange={(event) => {
          const selected = event.currentTarget.value;
          const option = KINDLE_LANGUAGE_OPTIONS.find(
            (candidate) => candidate.value === selected
          );
          if (option === undefined) return;
          props.setDrafts((draft) => ({
            ...draft,
            kindleLanguage: option.value,
          }));
        }}
      >
        <For each={KINDLE_LANGUAGE_OPTIONS}>
          {(option) => <option value={option.value}>{option.label}</option>}
        </For>
      </Select>
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
      <LanguageRow drafts={props.drafts} setDrafts={props.setDrafts} />
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
