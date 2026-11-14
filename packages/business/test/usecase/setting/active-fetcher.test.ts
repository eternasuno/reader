import { describe, expect, it } from '@effect/vitest';
import { Cause, Effect, Exit, Option, Redacted, Schema } from 'effect';
import type { JinaKey } from '../../../src/entity/setting/fetcher';
import { Setting } from '../../../src/entity/setting/setting';
import {
  type ActiveFetcher,
  activeFetcher,
} from '../../../src/usecase/setting/active-fetcher';
import { alice } from '../../support/fixtures';

const decodeSetting = Schema.decodeSync(Setting);

const jinaSetting = (key?: string): Setting =>
  decodeSetting({
    ownerId: alice,
    feed: {},
    fetcher: { provider: 'jina', jina: { key }, browser: {} },
  });

const browserSetting = (endpoint?: string): Setting =>
  decodeSetting({
    ownerId: alice,
    feed: {},
    fetcher: { provider: 'browser', jina: {}, browser: { endpoint } },
  });

const jinaKey = (fetcher: ActiveFetcher): Option.Option<JinaKey> => {
  if (fetcher._tag !== 'Jina') {
    throw new Error(`expected the Jina fetcher, got ${fetcher._tag}`);
  }

  return fetcher.key;
};

describe('activeFetcher', () => {
  it.effect('SET-ACTIVE-1 reports Jina without a key', () =>
    Effect.gen(function* () {
      const fetcher = yield* activeFetcher(jinaSetting());
      const key = jinaKey(fetcher);

      expect(fetcher._tag).toBe('Jina');
      expect(Option.isNone(key)).toBe(true);
    })
  );

  it.effect('SET-ACTIVE-1 reports Jina with the stored key', () =>
    Effect.gen(function* () {
      const fetcher = yield* activeFetcher(jinaSetting('jina-secret'));
      const key = jinaKey(fetcher);

      expect(fetcher._tag).toBe('Jina');
      expect(Redacted.value(Option.getOrThrow(key))).toBe('jina-secret');
    })
  );

  it.effect('SET-ACTIVE-1 reports the browser with its endpoint', () =>
    Effect.gen(function* () {
      const fetcher = yield* activeFetcher(
        browserSetting('ws://127.0.0.1:9222')
      );

      expect(fetcher._tag).toBe('Browser');
      expect(
        fetcher._tag === 'Browser' && Redacted.value(fetcher.endpoint).href
      ).toBe('ws://127.0.0.1:9222/');
    })
  );

  it.effect(
    'SET-ACTIVE-2 treats the browser without an endpoint as a defect',
    () =>
      Effect.gen(function* () {
        const exit = yield* Effect.exit(activeFetcher(browserSetting()));

        expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      })
  );
});
