import { expect, it } from '@effect/vitest';
import { FeedPreviewStore, type PendingFeedPreview } from '@reader/business';
import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { FeedPreviewStoreLive } from '../../src/adapter/feed-preview-store';

const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

const paragraph =
  'The committee reviewed the proposal in detail and asked staff to return with cost estimates before the next public meeting. '.repeat(
    30
  );

const pendingPreview = (
  owner: string,
  expiresAt: number
): PendingFeedPreview => ({
  owner,
  url: `https://example.com/${owner}.xml`,
  imported: { title: 'News', articles: [], retention: 500 },
  expiresAt,
});

const briefedPreview = (
  owner: string,
  expiresAt: number,
  count: number
): PendingFeedPreview => ({
  owner,
  url: `https://example.com/${owner}.xml`,
  imported: {
    title: 'Daily Briefing',
    retention: 500,
    articles: Array.from({ length: count }, (_, index) => ({
      identity: `${owner}-${index}`,
      url: `https://example.com/${owner}/${index}`,
      title: `Article ${index}`,
      description: paragraph,
      publishedAt: '2026-10-17T00:00:00.000Z',
    })),
  },
  expiresAt,
});

const previewBytes = (preview: PendingFeedPreview) =>
  Buffer.byteLength(JSON.stringify(preview), 'utf8');

it.effect('stores previews per owner until they expire', () =>
  Effect.gen(function* () {
    const store = yield* FeedPreviewStore;
    const token = yield* store.save(pendingPreview('alice', 1000), 0);
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(yield* store.find('alice', token, 999)).toEqual(
      pendingPreview('alice', 1000)
    );
    expect(yield* store.find('bob', token, 999)).toBeUndefined();
    expect(yield* store.find('alice', token, 1000)).toBeUndefined();
    expect(yield* store.find('alice', token, 999)).toBeUndefined();
  }).pipe(Effect.provide(FeedPreviewStoreLive))
);

it.effect('keeps at most one thousand pending previews', () =>
  Effect.gen(function* () {
    const store = yield* FeedPreviewStore;
    const tokens: string[] = [];
    for (let index = 0; index < 1001; index++) {
      tokens.push(yield* store.save(pendingPreview('alice', 1_000_000), 0));
    }

    expect(yield* store.find('alice', tokens[0] ?? '', 0)).toBeUndefined();
    expect(yield* store.find('alice', tokens[1] ?? '', 0)).toBeDefined();
    expect(yield* store.find('alice', tokens[1000] ?? '', 0)).toBeDefined();
  }).pipe(Effect.provide(FeedPreviewStoreLive))
);

it.effect('drops expired previews when saving', () =>
  Effect.gen(function* () {
    const store = yield* FeedPreviewStore;
    const expired = yield* store.save(pendingPreview('alice', 100), 0);
    yield* store.save(pendingPreview('bob', 500), 150);
    expect(yield* store.find('alice', expired, 0)).toBeUndefined();
  }).pipe(Effect.provide(FeedPreviewStoreLive))
);

it.effect('frees bytes when a find drops an expired preview', () =>
  Effect.gen(function* () {
    const store = yield* FeedPreviewStore;
    const preview = briefedPreview('alice', 1_000_000, 250);
    const bytes = previewBytes(preview);
    expect(bytes).toBeLessThan(MAX_PREVIEW_BYTES);

    const capacity = Math.floor(MAX_TOTAL_BYTES / bytes);
    expect(capacity * bytes).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
    expect((capacity + 1) * bytes).toBeGreaterThan(MAX_TOTAL_BYTES);

    const kept: string[] = [];
    for (let index = 0; index < capacity - 1; index++) {
      kept.push(yield* store.save(preview, 0));
    }

    const expired = yield* store.save({ ...preview, expiresAt: 100 }, 0);
    expect(yield* store.find('alice', expired, 150)).toBeUndefined();

    const latest = yield* store.save(preview, 150);
    expect(yield* store.find('alice', latest, 150)).toBeDefined();
    for (const token of kept) {
      expect(yield* store.find('alice', token, 150)).toBeDefined();
    }
  }).pipe(Effect.provide(FeedPreviewStoreLive))
);

it.effect('sweeps expired previews without another save', () =>
  Effect.gen(function* () {
    const store = yield* FeedPreviewStore;
    const expired = yield* store.save(pendingPreview('alice', 1000), 0);
    yield* TestClock.adjust('2 minutes');
    yield* Effect.yieldNow;

    expect(yield* store.find('alice', expired, 0)).toBeUndefined();
  }).pipe(Effect.provide(FeedPreviewStoreLive))
);

it.effect('rejects a preview larger than one stored feed may use', () =>
  Effect.gen(function* () {
    const store = yield* FeedPreviewStore;
    const oversized = briefedPreview('alice', 1_000_000, 2000);
    expect(previewBytes(oversized)).toBeGreaterThan(MAX_PREVIEW_BYTES);

    const error = yield* Effect.flip(store.save(oversized, 0));
    expect(error._tag).toBe('FeedPreviewStoreError');
    expect(error.error).toBe('订阅源内容过大，暂时无法添加');
  }).pipe(Effect.provide(FeedPreviewStoreLive))
);

it.effect('evicts the oldest previews to stay inside the byte budget', () =>
  Effect.gen(function* () {
    const store = yield* FeedPreviewStore;
    const preview = briefedPreview('alice', 1_000_000, 250);
    const bytes = previewBytes(preview);
    expect(bytes).toBeLessThan(MAX_PREVIEW_BYTES);

    const capacity = Math.floor(MAX_TOTAL_BYTES / bytes);
    const tokens: string[] = [];
    for (let index = 0; index < capacity + 3; index++) {
      tokens.push(yield* store.save(preview, 0));
    }

    const kept = tokens.slice(3);
    expect(yield* store.find('alice', tokens[0] ?? '', 0)).toBeUndefined();
    for (const token of kept) {
      expect(yield* store.find('alice', token, 0)).toBeDefined();
    }

    expect(kept.length).toBe(capacity);
    expect(kept.length * bytes).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
    expect((kept.length + 1) * bytes).toBeGreaterThan(MAX_TOTAL_BYTES);
  }).pipe(Effect.provide(FeedPreviewStoreLive))
);
