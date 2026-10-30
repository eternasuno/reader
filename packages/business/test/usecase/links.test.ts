import { expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
  countUnreadLinks,
  LinkRepository,
  LinkTitle,
  listLinks,
  markAllLinks,
  markLink,
  markLoadedLinks,
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

        return Effect.undefined;
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

it.effect('counts unread links for the owner', () =>
  Effect.gen(function* () {
    expect(yield* countUnreadLinks('alice')).toEqual({ count: 3 });
  }).pipe(
    Effect.provide(
      Layer.mock(LinkRepository, {
        unreadCount: (owner) => {
          expect(owner).toBe('alice');

          return Effect.succeed(3);
        },
      })
    )
  )
);

const linkItems = Array.from({ length: 31 }, (_, index) => ({
  key: String(index),
  url: `https://example.com/${index}`,
  title: String(index),
  createdAt: '2026-01-01T00:00:00.000Z',
  read: false,
}));

const linkRepositoryLayer = Layer.mock(LinkRepository, {
  list: (owner, read, offset, limit, all, before, beforeKey) => {
    expect([owner, read, offset, limit, all, before, beforeKey]).toEqual([
      'alice',
      false,
      30,
      31,
      true,
      '2026-01-01T00:00:00.000Z',
      'cursor',
    ]);

    return Effect.succeed(linkItems);
  },
  markAll: (owner) => {
    expect(owner).toBe('alice');

    return Effect.void;
  },
});

it.effect('forwards cursor pagination and marks all links for the owner', () =>
  Effect.gen(function* () {
    const page = yield* listLinks(
      'alice',
      false,
      30,
      true,
      '2026-01-01T00:00:00.000Z',
      'cursor'
    );
    expect(page.items).toHaveLength(30);
    expect(page.hasMore).toBe(true);
    expect(yield* markAllLinks('alice')).toEqual({ ok: true });
  }).pipe(Effect.provide(linkRepositoryLayer))
);

it.effect('marks only the loaded keys through one owner-scoped update', () => {
  const calls: (readonly [string, readonly string[]])[] = [];

  return Effect.gen(function* () {
    const keys = ['a'.repeat(64), 'b'.repeat(64)];
    expect(yield* markLoadedLinks('alice', keys)).toEqual({ ok: true });
    expect(yield* markLoadedLinks('alice', [])).toEqual({ ok: true });
    expect(calls).toEqual([
      ['alice', keys],
      ['alice', []],
    ]);
  }).pipe(
    Effect.provide(
      Layer.mock(LinkRepository, {
        markLoaded: (owner, keys) => {
          calls.push([owner, keys]);

          return Effect.void;
        },
      })
    )
  );
});

it('validates link protocols without stripping meaningful query parameters', () => {
  expect(normalizeLink(' https://example.com/a?token=x#part ')).toBe(
    'https://example.com/a?token=x#part'
  );
  expect(() => normalizeLink('javascript:alert(1)')).toThrow();
  expect(() => normalizeLink('https://user:password@example.com')).toThrow();
  expect(() => normalizeLink(null)).toThrow();
});
