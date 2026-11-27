import type { StoreSetter } from 'solid-js';
import type { KindleSendRecord } from '../api';
import { locale, t } from '../i18n';
import type { SettingsDrafts } from '../state';
import { COMMON_TIMEZONES } from './kindleTimezones';

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

/** `SET-KINDLE-1`: the time zone picker's option groups, each zone listed once. */
export interface TimezoneGroups {
  current: ReadonlyArray<TimezoneOption>;
  common: ReadonlyArray<TimezoneOption>;
  others: ReadonlyArray<TimezoneOption>;
}

interface ZoneEntry {
  zone: string;
  name: string;
  offset: number | null;
}

/**
 * The engine's canonical spelling, so aliases such as `Asia/Kolkata` and `Asia/Calcutta` match;
 * names the engine does not know (e.g. a legacy saved zone) stay as they are.
 */
const canonicalZone = (zone: string): string => {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
    }).resolvedOptions().timeZone;
  } catch {
    return zone;
  }
};

/** Minutes east of UTC today, or `null` for a zone the engine does not know. */
const zoneOffset = (timeZone: string, at: Date): number | null => {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    });
  } catch {
    return null;
  }
  // `longOffset` yields `GMT`, `GMT+08:00`, or `GMT-03:30`.
  const name = formatter
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value;
  if (name === 'GMT') return 0;
  const match =
    name === undefined ? null : /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  if (!match) throw new Error(`unexpected UTC offset ${name} for ${timeZone}`);
  const minutes = Number(match[2]) * 60 + Number(match[3]);

  return match[1] === '-' ? -minutes : minutes;
};

const formatOffset = (minutes: number): string => {
  const abs = Math.abs(minutes);

  return `UTC${minutes < 0 ? '-' : '+'}${padTwoDigits(Math.floor(abs / 60))}:${padTwoDigits(abs % 60)}`;
};

const byOffset = (a: ZoneEntry, b: ZoneEntry): number =>
  (a.offset ?? 0) - (b.offset ?? 0) || a.name.localeCompare(b.name);

const toOption = (entry: ZoneEntry, suffix = ''): TimezoneOption => ({
  value: entry.zone,
  label:
    entry.offset === null
      ? `${entry.name}${suffix}`
      : `${formatOffset(entry.offset)} · ${entry.name}${suffix}`,
});

/**
 * `SET-KINDLE-1`: `current` pins the device zone and the selected zone; `common` is the curated
 * list in `kindleTimezones.ts`; `others` holds every remaining supported zone only when
 * `showAll` is set. Groups sort by today's UTC offset and labels read `UTC±HH:MM · City`.
 */
export const timezoneGroups = (
  selected: string,
  device: string,
  showAll: boolean,
  now: Date = new Date()
): TimezoneGroups => {
  const cities = new Map(
    COMMON_TIMEZONES.map((entry) => [canonicalZone(entry.zone), entry.city])
  );
  const seen = new Set<string>();
  const entry = (zone: string): ZoneEntry | null => {
    const key = canonicalZone(zone);
    if (seen.has(key)) return null;
    seen.add(key);
    const city = cities.get(key);

    return { zone, name: city ? t(city) : zone, offset: zoneOffset(zone, now) };
  };
  const collect = (zones: ReadonlyArray<string>): Array<ZoneEntry> =>
    zones.flatMap((zone) => entry(zone) ?? []);

  const deviceEntry = entry(device);
  const current = [
    ...(deviceEntry
      ? [toOption(deviceEntry, t('kindle.timezoneDeviceSuffix'))]
      : []),
    ...collect([selected]).map((item) => toOption(item)),
  ];
  const common = collect(COMMON_TIMEZONES.map((item) => item.zone)).sort(
    byOffset
  );
  const others = showAll
    ? collect(['UTC', ...Intl.supportedValuesOf('timeZone')]).sort(byOffset)
    : [];

  return {
    current,
    common: common.map((item) => toOption(item)),
    others: others.map((item) => toOption(item)),
  };
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
