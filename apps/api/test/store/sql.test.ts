import { describe, expect, it } from '@effect/vitest';
import { Effect, Fiber, Semaphore } from 'effect';
import type { Surreal } from 'surrealdb';
import { run } from '../../src/store/sql';

const pendingQuery = () => {
  let settle: (rows: Array<unknown>) => void = () => undefined;
  let markStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const db = {
    query: () =>
      new Promise<Array<unknown>>((resolve) => {
        settle = resolve;
        markStarted();
      }),
  } as unknown as Surreal;

  return { db, started, settle: (rows: Array<unknown>) => settle(rows) };
};

describe('run', () => {
  it.effect('keeps the write permit until a started query settles', () =>
    Effect.gen(function* () {
      const lock = yield* Semaphore.make(1);
      const query = pendingQuery();
      const write = yield* run(query.db, 'UPDATE x', {}, () => 'failed').pipe(
        lock.withPermit,
        Effect.forkChild
      );

      yield* Effect.promise(() => query.started);
      const interrupted = yield* Fiber.interrupt(write).pipe(Effect.forkChild);
      const acquired = yield* Effect.succeed('next writer').pipe(
        lock.withPermit,
        Effect.forkChild
      );

      yield* Effect.yieldNow;
      expect(acquired.pollUnsafe()).toBeUndefined();

      query.settle([]);
      yield* Fiber.join(interrupted);
      expect(yield* Fiber.join(acquired)).toBe('next writer');
    })
  );
});
