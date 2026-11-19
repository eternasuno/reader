import type { KindleSendRecord } from '../api';
import { locale, t } from '../i18n';

const STATUS_KEYS = {
  on: 'settings.statusConfigured',
  off: 'settings.statusNotConfigured',
} as const;

export type StatusKey = (typeof STATUS_KEYS)[keyof typeof STATUS_KEYS];

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
  running: 'text-base-content/70',
  succeeded: 'text-success',
  failed: 'text-error',
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
export const sanitizeError = (error: string | undefined): string => {
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
      ? `${String(t('kindle.resultFailed'))}：${summary}`
      : String(t('kindle.resultFailed'));
  }

  if (record.status === 'succeeded') {
    return record.articleCount > 0
      ? String(
          t('kindle.resultSent', {
            articles: record.articleCount,
            books: record.bookCount,
          })
        )
      : String(t('kindle.resultEmpty'));
  }

  return '';
};
