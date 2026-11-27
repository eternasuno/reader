const FALLBACK_TIMEZONE = 'UTC';

/** Engines report these when the device zone is not a real IANA zone; the server rejects them. */
const UNUSABLE_ZONES = new Set(['', 'Etc/Unknown', 'Local']);

/**
 * `SET-KINDLE-1`: the device's IANA time zone, the default for a Kindle schedule that has
 * not been saved yet; `UTC` when the browser reports none.
 */
export const browserTimezone = (): string => {
  const zone: unknown = new Intl.DateTimeFormat().resolvedOptions().timeZone;

  return typeof zone === 'string' && !UNUSABLE_ZONES.has(zone)
    ? zone
    : FALLBACK_TIMEZONE;
};
