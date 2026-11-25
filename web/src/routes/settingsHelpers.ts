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

/** `settings.md:16-17`: `sendTime` accepts every half-hour slot of the day. */
export const SEND_TIME_SLOTS: ReadonlyArray<string> = Array.from(
  { length: 48 },
  (_, index) => {
    const hour = String(Math.floor(index / 2)).padStart(2, '0');
    return `${hour}:${index % 2 === 0 ? '00' : '30'}`;
  }
);

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
