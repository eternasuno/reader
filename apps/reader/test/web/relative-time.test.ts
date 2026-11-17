import { describe, expect, it } from 'vitest';
import { relativeTime } from '../../src/web/ui/relative-time';

/**
 * The relative date of a list row (reader-spec Shared messages): `刚刚` under a
 * minute, then minutes, hours and days up to 30, then the `zh-CN` date.
 */

const now = Date.parse('2026-11-17T12:00:00.000Z');
const ago = (milliseconds: number) =>
  new Date(now - milliseconds).toISOString();

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

describe('relativeTime', () => {
  it('shows 刚刚 under a minute', () => {
    expect(relativeTime(ago(0), now)).toBe('刚刚');
    expect(relativeTime(ago(59_999), now)).toBe('刚刚');
  });

  it('counts minutes, hours and days', () => {
    expect(relativeTime(ago(minute), now)).toBe('1分前');
    expect(relativeTime(ago(59 * minute), now)).toBe('59分前');
    expect(relativeTime(ago(hour), now)).toBe('1小时前');
    expect(relativeTime(ago(23 * hour), now)).toBe('23小时前');
    expect(relativeTime(ago(day), now)).toBe('1天前');
    expect(relativeTime(ago(30 * day), now)).toBe('30天前');
  });

  it('shows the zh-CN date after 30 days', () => {
    const iso = ago(31 * day);

    expect(relativeTime(iso, now)).toBe(
      new Date(iso).toLocaleDateString('zh-CN')
    );
  });

  it('treats a publish time in the future as 刚刚', () => {
    expect(relativeTime(ago(-hour), now)).toBe('刚刚');
  });
});
