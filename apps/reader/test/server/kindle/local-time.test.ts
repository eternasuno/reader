import { describe, expect, it } from '@effect/vitest';
import { SendTime } from '@reader/business';
import { Schema } from 'effect';
import { nextOccurrence } from '../../../src/server/kindle/local-time';

const time = (value: string): SendTime => Schema.decodeSync(SendTime)(value);

/** A server-local wall clock reading as the instant it names (KD-SCHED-1). */
const at = (day: number, hours: number, minutes: number, seconds = 0): number =>
  new Date(2026, 0, day, hours, minutes, seconds, 0).getTime();

describe('nextOccurrence', () => {
  it('KD-SCHED-2 takes a later time on the same local day', () => {
    expect(nextOccurrence(at(5, 6, 10), time('07:00'))).toBe(at(5, 7, 0));
    expect(nextOccurrence(at(5, 6, 10), time('06:30'))).toBe(at(5, 6, 30));
  });

  it('KD-SCHED-2 takes the next local day once the time has passed', () => {
    expect(nextOccurrence(at(5, 8, 0), time('07:00'))).toBe(at(6, 7, 0));
    expect(nextOccurrence(at(5, 8, 0), time('07:30'))).toBe(at(6, 7, 30));
  });

  it('KD-SCHED-2 is strictly after now, so a time that is now is tomorrow', () => {
    expect(nextOccurrence(at(5, 7, 0), time('07:00'))).toBe(at(6, 7, 0));
    expect(nextOccurrence(at(5, 7, 30), time('07:30'))).toBe(at(6, 7, 30));
  });

  it('KD-SCHED-2 crosses the month and the year', () => {
    const newYearsEve = new Date(2026, 11, 31, 23, 40).getTime();

    expect(nextOccurrence(newYearsEve, time('07:00'))).toBe(
      new Date(2027, 0, 1, 7, 0).getTime()
    );
  });
});
