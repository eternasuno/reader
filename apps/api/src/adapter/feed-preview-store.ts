import { randomUUID } from 'node:crypto';
import {
  FeedPreviewStore,
  FeedPreviewStoreError,
  type PendingFeedPreview,
} from '@reader/business';
import { Clock, Duration, Effect, Layer, Schedule } from 'effect';

const MAX_PREVIEWS = 1000;
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const SWEEP_INTERVAL = Duration.minutes(1);

type Entry = {
  readonly preview: PendingFeedPreview;
  readonly bytes: number;
};

type Entries = Map<string, Entry>;

const isExpired = (preview: PendingFeedPreview, now: number) =>
  preview.expiresAt <= now;

const utf8Bytes = (preview: PendingFeedPreview) =>
  Buffer.byteLength(JSON.stringify(preview), 'utf8');

const findPreview = (
  entries: Entries,
  owner: string,
  token: string,
  now: number,
  remove: (token: string) => void
) => {
  const entry = entries.get(token);
  if (!entry) {
    return undefined;
  }

  if (isExpired(entry.preview, now)) {
    remove(token);

    return undefined;
  }

  return entry.preview.owner === owner ? entry.preview : undefined;
};

const createPreviewCache = () => {
  const entries: Entries = new Map();
  let bytes = 0;

  const remove = (token: string) => {
    const entry = entries.get(token);
    if (!entry) {
      return;
    }

    entries.delete(token);
    bytes -= entry.bytes;
  };
  const sweep = (now: number) => {
    for (const [token, entry] of entries) {
      if (isExpired(entry.preview, now)) {
        remove(token);
      }
    }
  };
  const evictOldest = () => {
    const oldest = entries.keys().next();
    if (oldest.done) {
      return;
    }

    remove(oldest.value);
  };
  const find = (owner: string, token: string, now: number) =>
    findPreview(entries, owner, token, now, remove);
  const save = (preview: PendingFeedPreview, now: number) =>
    Effect.gen(function* () {
      const size = utf8Bytes(preview);
      if (size > MAX_PREVIEW_BYTES) {
        return yield* new FeedPreviewStoreError({
          error: '订阅源内容过大，暂时无法添加',
        });
      }

      sweep(now);
      while (
        entries.size > 0 &&
        (entries.size >= MAX_PREVIEWS || bytes + size > MAX_TOTAL_BYTES)
      ) {
        evictOldest();
      }

      const token = randomUUID();
      entries.set(token, { preview, bytes: size });
      bytes += size;

      return token;
    });

  return { find, save, sweep };
};

export const FeedPreviewStoreLive = Layer.effect(
  FeedPreviewStore,
  Effect.gen(function* () {
    const cache = createPreviewCache();

    yield* Clock.currentTimeMillis.pipe(
      Effect.tap((now) => Effect.sync(() => cache.sweep(now))),
      Effect.repeat(Schedule.spaced(SWEEP_INTERVAL)),
      Effect.forkScoped
    );

    return FeedPreviewStore.of({
      save: cache.save,
      find: (owner, token, now) =>
        Effect.sync(() => cache.find(owner, token, now)),
    });
  })
);
