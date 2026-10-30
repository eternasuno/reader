import { expect, it } from '@effect/vitest';
import { Schema } from 'effect';
import { Feed } from '../../src';

const feed = (unreadCount: number) => ({
  key: 'feed-key',
  url: 'https://example.com/feed',
  title: 'Example',
  updatedAt: '2026-10-30T00:00:00.000Z',
  error: '',
  unreadCount,
});

it('accepts a non-negative integer unread count', () => {
  expect(Schema.decodeSync(Feed)(feed(12)).unreadCount).toBe(12);
  expect(Schema.decodeSync(Feed)(feed(0)).unreadCount).toBe(0);
});

it('rejects negative and fractional unread counts', () => {
  expect(() => Schema.decodeSync(Feed)(feed(-1))).toThrow();
  expect(() => Schema.decodeSync(Feed)(feed(1.5))).toThrow();
});
