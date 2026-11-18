import { describe, expect, it } from '@effect/vitest';
import { Cause, Effect, Exit, Option, Redacted, Schema } from 'effect';
import { Setting } from '../../../src/entity/setting/setting';
import { activeFetcher } from '../../../src/usecase/setting/active-fetcher';
import { alice } from '../../support/fixtures';
import { endpoint, endpointHref } from './harness';

const settingOf = (input: Record<string, string>): Setting =>
  Schema.decodeSync(Setting)({ ownerId: alice, ...input });

describe('activeFetcher', () => {
  it.effect('SET-ACTIVE-1 gives Jina with the stored key', () =>
    Effect.gen(function* () {
      const active = yield* activeFetcher(settingOf({ jinaKey: 'sk-live' }));

      expect(active._tag).toBe('Jina');

      if (active._tag === 'Jina') {
        expect(Redacted.value(Option.getOrThrow(active.key))).toBe('sk-live');
      }
    })
  );

  it.effect('SET-ACTIVE-1 gives Jina with no key when none is stored', () =>
    Effect.gen(function* () {
      const active = yield* activeFetcher(settingOf({}));

      expect(active).toStrictEqual({ _tag: 'Jina', key: Option.none() });
    })
  );

  it.effect('SET-ACTIVE-1 gives Browser with the stored endpoint', () =>
    Effect.gen(function* () {
      const setting = Schema.decodeSync(Setting)({
        ownerId: alice,
        provider: 'browser',
        browserEndpoint: Redacted.value(endpoint).href,
      });
      const active = yield* activeFetcher(setting);

      expect(active._tag).toBe('Browser');

      if (active._tag === 'Browser') {
        expect(Redacted.value(active.endpoint).href).toBe(endpointHref);
      }
    })
  );

  it.effect('SET-ACTIVE-2 browser without an endpoint is a defect', () =>
    Effect.gen(function* () {
      const setting = Schema.decodeSync(Setting)({
        ownerId: alice,
        provider: 'browser',
      });
      const exit = yield* Effect.exit(activeFetcher(setting));

      expect(Exit.isFailure(exit)).toBe(true);

      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
      }
    })
  );
});
