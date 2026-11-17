import { describe, expect, it } from '@effect/vitest';
import { Result, Schema } from 'effect';
import { Retention } from '../../../src/entity/setting/retention';

const decode = Schema.decodeUnknownResult(Retention);

const isInvalid = (value: unknown): boolean => Result.isFailure(decode(value));

describe('Retention', () => {
  it('SET-VAL-1 accepts any integer of at least 1 and defines no upper bound', () => {
    for (const value of [1, 2, 30, 100, 500, 100_000]) {
      expect(Result.getOrThrow(decode(value))).toBe(value);
    }
  });

  it('SET-VAL-1 defaults to 100 when nothing is stored', () => {
    expect(Result.getOrThrow(decode(undefined))).toBe(100);
  });

  it('SET-VAL-1 rejects zero, negative and non-integer values', () => {
    for (const value of [0, -1, 2.5, '100', null]) {
      expect(isInvalid(value)).toBe(true);
    }
  });
});
