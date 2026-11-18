import type { SendTime } from '@reader/business';

/**
 * The server-local calendar of an instant, read with the process's `TZ`
 * (deployment.md Environment variables, KD-SCHED-1). The clock itself is
 * Effect's, so a test clock decides what these return.
 */
const pad = (value: number): string => String(value).padStart(2, '0');

/** The server-local date as `YYYY-MM-DD`, the send's date (KD-SEND-4, KD-BOOK-1). */
export const localDate = (epochMillis: number): string => {
  const date = new Date(epochMillis);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * The next server-local occurrence of `time` strictly after `nowMillis`: today
 * at that time, or tomorrow's once today's has passed (KD-SCHED-1, KD-SCHED-2).
 * A local time that a daylight-saving change skips moves forward to the first
 * instant that exists, and a repeated one takes its first occurrence, which is
 * how `Date#setHours` resolves both.
 */
export const nextOccurrence = (nowMillis: number, time: SendTime): number => {
  const hours = Number(time.slice(0, 2));
  const minutes = Number(time.slice(3, 5));
  const date = new Date(nowMillis);

  date.setHours(hours, minutes, 0, 0);

  if (date.getTime() <= nowMillis) {
    date.setDate(date.getDate() + 1);
    date.setHours(hours, minutes, 0, 0);
  }

  return date.getTime();
};
