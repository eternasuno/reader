import type { StoreSetter } from 'solid-js';
import type { KindleSendRecord } from '../api';
import { locale, t } from '../i18n';
import type { SettingsDrafts } from '../state';

export interface SettingsDraftProps {
  drafts: SettingsDrafts;
  setDrafts: StoreSetter<SettingsDrafts>;
}

const STATUS_KEYS = {
  on: 'settings.statusConfigured',
  off: 'settings.statusNotConfigured',
} as const;

type StatusKey = (typeof STATUS_KEYS)[keyof typeof STATUS_KEYS];

export const statusKey = (configured: boolean | undefined): StatusKey =>
  configured ? STATUS_KEYS.on : STATUS_KEYS.off;

export const TRIGGER_KEYS = {
  manual: 'kindle.triggerManual',
  scheduled: 'kindle.triggerScheduled',
} as const;

export const SEND_STATUS_KEYS = {
  running: 'kindle.statusRunning',
  succeeded: 'kindle.statusSucceeded',
  failed: 'kindle.statusFailed',
} as const;

export const SEND_STATUS_CLASSES = {
  running: 'border-0 bg-info/15 text-info',
  succeeded: 'border-0 bg-success/15 text-success',
  failed: 'border-0 bg-error/15 text-error',
} as const;

/** `SET-KINDLE-1`: the schedule hour is 0–23 and the minute is 0–55 in 5-minute steps. */
export const HOUR_OPTIONS: ReadonlyArray<number> = Array.from(
  { length: 24 },
  (_, hour) => hour
);

export const MINUTE_OPTIONS: ReadonlyArray<number> = Array.from(
  { length: 12 },
  (_, step) => step * 5
);

export const padTwoDigits = (value: number): string =>
  String(value).padStart(2, '0');

export interface TimezoneOption {
  value: string;
  label: string;
}

/** `longOffset` yields `GMT`, `GMT+08:00`, or `GMT-03:30`; show it as `UTC±HH:MM`. */
const utcOffsetLabel = (timeZone: string, at: Date): string => {
  const offset = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value;
  if (offset === undefined) throw new Error(`no UTC offset for ${timeZone}`);

  return offset === 'GMT' ? 'UTC+00:00' : offset.replace('GMT', 'UTC');
};

/** `UTC` first, then every other supported IANA zone labelled `Name (UTC±HH:MM)` for today. */
export const timezoneOptions = (): ReadonlyArray<TimezoneOption> => {
  const now = new Date();
  const zones = new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]);

  return Array.from(zones, (zone) => ({
    value: zone,
    label: `${zone} (${utcOffsetLabel(zone, now)})`,
  }));
};

/** `kindle.md`: sanitized error summaries never inject markup or stray line breaks. */
const sanitizeError = (error: string | undefined): string => {
  if (error === undefined) return '';

  return error
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 200);
};

export const formatTimestamp = (iso: string): string => {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return iso;

  return new Intl.DateTimeFormat(locale(), {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(timestamp);
};

export const sendResultText = (record: KindleSendRecord): string => {
  if (record.status === 'failed') {
    const summary = sanitizeError(record.error);
    return summary.length > 0
      ? `${t('kindle.resultFailed')}：${summary}`
      : t('kindle.resultFailed');
  }

  if (record.status === 'succeeded') {
    return record.articleCount > 0
      ? t('kindle.resultSent', {
          articles: record.articleCount,
          books: record.bookCount,
        })
      : t('kindle.resultEmpty');
  }

  return '';
};
