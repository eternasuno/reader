import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../src/i18n';
import { COMMON_TIMEZONES } from '../src/routes/kindleTimezones';
import { timezoneGroups } from '../src/routes/settingsHelpers';
import { browserTimezone } from '../src/state/browserTimezone';

const JANUARY = new Date('2026-01-15T00:00:00Z');
const JULY = new Date('2026-07-15T00:00:00Z');

const canonical = (zone: string): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions()
    .timeZone;

const offsetOf = (label: string): number => {
  const match = /^UTC([+-])(\d{2}):(\d{2})/.exec(label);
  if (!match) throw new Error(`no offset in ${label}`);
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
};

afterEach(() => {
  vi.restoreAllMocks();
  setLocale('zh-CN');
});

describe('COMMON_TIMEZONES', () => {
  it('lists only zones the engine knows, each once', () => {
    const zones = COMMON_TIMEZONES.map((entry) => entry.zone);
    expect(() => zones.map(canonical)).not.toThrow();
    expect(new Set(zones.map(canonical)).size).toBe(zones.length);
  });
});

describe('timezoneGroups', () => {
  it('pins the device and selected zones, deduplicating aliases across groups', () => {
    setLocale('zh-CN');
    const groups = timezoneGroups(
      'Asia/Tokyo',
      'Asia/Calcutta',
      false,
      JANUARY
    );

    expect(groups.current).toEqual([
      { value: 'Asia/Calcutta', label: 'UTC+05:30 · 新德里 / 孟买（本机）' },
      { value: 'Asia/Tokyo', label: 'UTC+09:00 · 东京' },
    ]);
    const commonValues = groups.common.map((option) => option.value);
    expect(commonValues).not.toContain('Asia/Kolkata');
    expect(commonValues).not.toContain('Asia/Tokyo');
    expect(groups.common).toHaveLength(COMMON_TIMEZONES.length - 2);
    expect(groups.others).toEqual([]);
  });

  it('shows a zone the engine does not know without an offset', () => {
    const groups = timezoneGroups('Legacy/Zone', 'UTC', false, JANUARY);

    expect(groups.current.at(-1)).toEqual({
      value: 'Legacy/Zone',
      label: 'Legacy/Zone',
    });
  });

  it('computes offsets for the given date so DST shifts the order', () => {
    setLocale('en');
    const label = (at: Date) =>
      timezoneGroups('UTC', 'UTC', false, at).common.find(
        (option) => option.value === 'America/New_York'
      )?.label;

    expect(label(JANUARY)).toBe('UTC-05:00 · New York / Toronto');
    expect(label(JULY)).toBe('UTC-04:00 · New York / Toronto');
  });

  it('adds every remaining zone, sorted by offset, only when asked', () => {
    const groups = timezoneGroups('UTC', 'UTC', true, JANUARY);
    const all = [...groups.current, ...groups.common, ...groups.others].map(
      (option) => canonical(option.value)
    );

    expect(new Set(all).size).toBe(all.length);
    expect(groups.others.some((o) => o.value === 'Europe/Zurich')).toBe(true);
    const offsets = groups.others.map((option) => offsetOf(option.label));
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });
});

describe('browserTimezone', () => {
  const stubZone = (timeZone: string | undefined) =>
    vi
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ timeZone } as Intl.ResolvedDateTimeFormatOptions);

  it('returns the device zone', () => {
    stubZone('Asia/Shanghai');
    expect(browserTimezone()).toBe('Asia/Shanghai');
  });

  it.each([undefined, '', 'Etc/Unknown'])(
    'falls back to UTC when the device reports %s',
    (zone) => {
      stubZone(zone);
      expect(browserTimezone()).toBe('UTC');
    }
  );
});
