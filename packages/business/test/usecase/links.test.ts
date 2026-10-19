import { expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
  LinkRepository,
  LinkTitle,
  listLinks,
  markLink,
  normalizeLink,
  removeLink,
  saveLink,
} from '../../src';

it.effect('validates before invoking external capabilities', () =>
  Effect.gen(function* () {
    const result = yield* Effect.flip(saveLink('alice', 'javascript:alert(1)'));
    expect(result._tag).toBe('InvalidLink');
  }).pipe(
    Effect.provide(
      Layer.mergeAll(Layer.mock(LinkRepository, {}), Layer.mock(LinkTitle, {}))
    )
  )
);

it.effect(
  'coordinates title, time, duplicate detection and owner-scoped mutations',
  () => {
    const repository = Layer.mock(LinkRepository, {
      insert: (owner, item) => {
        expect(owner).toBe('alice');
        expect(item.url).toBe('https://example.com/a?q=1');
        expect(item.title).toBe('Article');
        expect(item.read).toBe(false);
        expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);

        return Effect.succeed(undefined);
      },
      mark: (owner, key, read) => {
        expect([owner, key, read]).toEqual(['alice', 'missing', true]);

        return Effect.succeed(false);
      },
      remove: (owner, key) => {
        expect([owner, key]).toEqual(['alice', 'missing']);

        return Effect.succeed(false);
      },
      list: (owner, read, offset, limit) => {
        expect([owner, read, offset, limit]).toEqual(['alice', false, 30, 31]);

        return Effect.succeed([]);
      },
    });

    return Effect.gen(function* () {
      expect(
        (yield* Effect.flip(saveLink('alice', ' https://example.com/a?q=1 ')))
          ._tag
      ).toBe('DuplicateLink');
      expect(
        (yield* Effect.flip(markLink('alice', 'missing', true)))._tag
      ).toBe('LinkNotFound');
      expect((yield* Effect.flip(removeLink('alice', 'missing')))._tag).toBe(
        'LinkNotFound'
      );
      expect(yield* listLinks('alice', false, 30)).toEqual({
        items: [],
        hasMore: false,
      });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          repository,
          Layer.succeed(LinkTitle, { fetch: () => Effect.succeed('Article') })
        )
      )
    );
  }
);

it('validates link protocols without stripping meaningful query parameters', () => {
  expect(normalizeLink(' https://example.com/a?token=x#part ')).toBe(
    'https://example.com/a?token=x#part'
  );
  expect(() => normalizeLink('javascript:alert(1)')).toThrow();
  expect(() => normalizeLink('https://user:password@example.com')).toThrow();
  expect(() => normalizeLink(null)).toThrow();
});
