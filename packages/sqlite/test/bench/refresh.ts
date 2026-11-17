import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import {
  ArticleTitle,
  Feed,
  type FeedId,
  FeedItem,
  type FeedItemId,
  FeedItemRepository,
  FeedRepository,
  FeedTitle,
  NormalizedUrl,
  OwnerId,
} from '@reader/business';
import { DateTime, Effect, Fiber, Layer, Option, Schema } from 'effect';
import {
  ReaderStoreLive,
  readerMigrationLayer,
  readerSqliteLayer,
} from '../../src';

const FEEDS = 200;
const ITEMS_PER_FEED = 100;
const PROBE_GAP_MS = 50;
const IDLE_PROBES = 40;

const scenarios = {
  regular: { incoming: 30, fresh: 5, pruned: 5 },
  heavy: { incoming: 100, fresh: 100, pruned: 100 },
} as const;

type Scenario = (typeof scenarios)[keyof typeof scenarios];

const [scenarioName = 'regular'] = process.argv.slice(2);
const scenario: Scenario =
  scenarios[scenarioName as keyof typeof scenarios] ?? scenarios.regular;

const owner = OwnerId.make('bench');
const decodeUrl = Schema.decodeSync(NormalizedUrl);
const decodeTitle = Schema.decodeSync(ArticleTitle);
const directory = mkdtempSync(join(tmpdir(), 'reader-bench-'));

const layer = ReaderStoreLive.pipe(
  Layer.provide(
    readerMigrationLayer.pipe(
      Layer.provideMerge(readerSqliteLayer(join(directory, 'reader.db')))
    )
  )
);

const item = (feedId: FeedId, index: number) =>
  FeedItem.make({
    ownerId: owner,
    feedId,
    url: decodeUrl(`https://example.com/${feedId}/${index}`),
    title: decodeTitle(`Item ${index}`),
    description: Option.none(),
    content: Option.none(),
    extractedContent: Option.none(),
    publishedAt: Option.none(),
    read: false,
  });

const seed = Effect.gen(function* () {
  const feeds = yield* FeedRepository;
  const items = yield* FeedItemRepository;
  const rows = Array.from({ length: FEEDS }, (_, index) =>
    Feed.make({
      ownerId: owner,
      url: decodeUrl(`https://example.com/feed/${index}`),
      title: FeedTitle.make(`Feed ${index}`),
      folderId: Option.none(),
      updatedAt: Option.none(),
    })
  );
  yield* feeds.create(owner, rows);
  yield* Effect.forEach(rows, (feed) =>
    items.create(
      owner,
      Array.from({ length: ITEMS_PER_FEED }, (_, index) => item(feed.id, index))
    )
  );

  return rows.map((feed) => feed.id);
});

const refresh = (feedId: FeedId) =>
  Effect.gen(function* () {
    const feeds = yield* FeedRepository;
    const items = yield* FeedItemRepository;
    const stored = yield* items.inventory(owner, feedId);
    const newest = ITEMS_PER_FEED + scenario.fresh;
    const incoming = Array.from({ length: scenario.incoming }, (_, offset) =>
      item(feedId, newest - offset)
    );
    yield* items.create(owner, incoming);
    yield* items.remove(
      owner,
      stored.slice(-scenario.pruned).map((key) => key.id)
    );
    yield* feeds.recordSync(
      owner,
      feedId,
      FeedTitle.make('Synced'),
      DateTime.nowUnsafe()
    );
  });

const probe = (ids: ReadonlyArray<FeedItemId>) =>
  Effect.gen(function* () {
    const items = yield* FeedItemRepository;
    const id = ids[Math.floor(Math.random() * ids.length)] as FeedItemId;
    const start = performance.now();
    yield* items.markRead(owner, [id], true);

    return performance.now() - start;
  });

const summary = (label: string, samples: ReadonlyArray<number>) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;

  console.log(
    `${label}: n=${sorted.length} p50=${at(0.5).toFixed(1)}ms p95=${at(0.95).toFixed(1)}ms max=${at(1).toFixed(1)}ms`
  );
};

const bench = Effect.gen(function* () {
  const items = yield* FeedItemRepository;
  const seedStart = performance.now();
  const feedIds = yield* seed;
  console.log(
    `sqlite ${scenarioName}: seeded ${FEEDS}x${ITEMS_PER_FEED} in ${((performance.now() - seedStart) / 1000).toFixed(1)}s`
  );
  const probeIds = (yield* items.listAll(owner, {
    unreadOnly: false,
    limit: 1000,
  })).map((row) => row.id);

  const idle: Array<number> = [];
  for (let index = 0; index < IDLE_PROBES; index += 1) {
    idle.push(yield* probe(probeIds));
  }

  summary('idle markRead', idle);

  const busy: Array<number> = [];
  let running = true;
  const prober = yield* Effect.forkChild(
    Effect.gen(function* () {
      while (running) {
        busy.push(yield* probe(probeIds));
        yield* Effect.sleep(PROBE_GAP_MS);
      }
    })
  );
  while (busy.length === 0) {
    yield* Effect.sleep(PROBE_GAP_MS);
  }

  busy.length = 0;
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();
  const roundStart = performance.now();
  yield* Effect.forEach(feedIds, refresh, {
    concurrency: 'unbounded',
    discard: true,
  });
  const round = performance.now() - roundStart;
  loopDelay.disable();
  running = false;
  yield* Fiber.join(prober);
  console.log(`refresh round: ${(round / 1000).toFixed(2)}s`);
  summary('markRead during refresh', busy);
  console.log(
    `event loop delay during refresh: p50=${(loopDelay.percentile(50) / 1e6).toFixed(1)}ms p99=${(loopDelay.percentile(99) / 1e6).toFixed(1)}ms max=${(loopDelay.max / 1e6).toFixed(1)}ms`
  );
});

Effect.runPromise(
  bench.pipe(
    Effect.provide(layer),
    Effect.ensuring(
      Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
    )
  )
);
