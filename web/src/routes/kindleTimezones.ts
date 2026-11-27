import type { Dict } from '../i18n';

export type TimezoneCityKey = `timezones.${keyof Dict['timezones'] & string}`;

/**
 * `SET-KINDLE-1`: the curated common time zones offered in the Kindle schedule picker. UTC
 * offsets are never stored here: they are computed at render time so DST stays correct, and
 * the picker sorts by them. To add a zone, append an entry and its city label in `zh.ts` and
 * `en.ts`.
 */
export const COMMON_TIMEZONES: ReadonlyArray<{
  zone: string;
  city: TimezoneCityKey;
}> = [
  { zone: 'Pacific/Honolulu', city: 'timezones.honolulu' },
  { zone: 'America/Anchorage', city: 'timezones.anchorage' },
  { zone: 'America/Los_Angeles', city: 'timezones.losAngeles' },
  { zone: 'America/Phoenix', city: 'timezones.phoenix' },
  { zone: 'America/Denver', city: 'timezones.denver' },
  { zone: 'America/Chicago', city: 'timezones.chicago' },
  { zone: 'America/Mexico_City', city: 'timezones.mexicoCity' },
  { zone: 'America/New_York', city: 'timezones.newYork' },
  { zone: 'America/Sao_Paulo', city: 'timezones.saoPaulo' },
  { zone: 'UTC', city: 'timezones.utc' },
  { zone: 'Europe/London', city: 'timezones.london' },
  { zone: 'Europe/Paris', city: 'timezones.paris' },
  { zone: 'Africa/Johannesburg', city: 'timezones.johannesburg' },
  { zone: 'Africa/Cairo', city: 'timezones.cairo' },
  { zone: 'Europe/Istanbul', city: 'timezones.istanbul' },
  { zone: 'Europe/Moscow', city: 'timezones.moscow' },
  { zone: 'Asia/Dubai', city: 'timezones.dubai' },
  { zone: 'Asia/Kolkata', city: 'timezones.kolkata' },
  { zone: 'Asia/Bangkok', city: 'timezones.bangkok' },
  { zone: 'Asia/Shanghai', city: 'timezones.shanghai' },
  { zone: 'Asia/Hong_Kong', city: 'timezones.hongKong' },
  { zone: 'Asia/Taipei', city: 'timezones.taipei' },
  { zone: 'Asia/Singapore', city: 'timezones.singapore' },
  { zone: 'Australia/Perth', city: 'timezones.perth' },
  { zone: 'Asia/Tokyo', city: 'timezones.tokyo' },
  { zone: 'Asia/Seoul', city: 'timezones.seoul' },
  { zone: 'Australia/Sydney', city: 'timezones.sydney' },
  { zone: 'Pacific/Auckland', city: 'timezones.auckland' },
];
