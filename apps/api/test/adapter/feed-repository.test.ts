import { expect, it } from '@effect/vitest';
import {
  type FeedArticle,
  FeedRepository,
  type ParsedFeed,
  prepareInitialImport,
  prepareRefreshImport,
} from '@reader/business';
import { Effect } from 'effect';
import {
  createEmptyFeed,
  createSubscribedFeed,
  makeParsed,
  runWithDatabase,
  syncFeed,
} from './feed-repository-support';

const verifyDescriptions = (
  repository: FeedRepository['Service'],
  key: string,
  article: string,
  parsed: ParsedFeed,
  now: string
) =>
  Effect.gen(function* () {
    expect(
      (yield* repository.article('alice', article))?.description
    ).toBeUndefined();
    const refreshed: ParsedFeed = {
      ...parsed,
      articles: parsed.articles.map((item) => ({
        ...item,
        description: '<p>Updated</p>',
      })),
    };
    yield* syncFeed(repository, 'bob', key, refreshed, now);
    expect(
      (yield* repository.article('alice', article))?.description
    ).toBeUndefined();
    yield* syncFeed(repository, 'alice', key, refreshed, now);
    const updated = yield* repository.article('alice', article);
    expect(updated?.description).toBe('<p>Updated</p>');
    expect(updated?.read).toBe(true);
    expect(
      (yield* repository.articles('alice', key, true, 0, 40))[0]?.description
    ).toBe('<p>Updated</p>');
  });

const verifyCoreFlows = Effect.gen(function* () {
  const repository = yield* FeedRepository;
  const url = 'https://example.com/rss';
  const now = new Date().toISOString();
  const parsed = makeParsed(35);
  const feed = yield* createSubscribedFeed(
    repository,
    'alice',
    url,
    parsed,
    now
  );
  const key = feed.key;
  expect(feed.unreadCount).toBe(30);
  expect(
    yield* createSubscribedFeed(repository, 'alice', url, parsed, now)
  ).toEqual(feed);
  const items = yield* repository.articles('alice', '', false, 0, 40);
  expect(items).toHaveLength(30);
  expect((yield* repository.list('alice'))[0]?.unreadCount).toBe(30);
  expect(yield* repository.list('bob')).toEqual([]);
  const article = items[0]?.key ?? '';
  expect(yield* repository.mark('bob', article, true)).toBe(false);
  yield* repository.mark('alice', article, true);
  expect((yield* repository.list('alice'))[0]?.unreadCount).toBe(29);
  yield* repository.mark('alice', article, false);
  expect((yield* repository.list('alice'))[0]?.unreadCount).toBe(30);
  yield* repository.mark('alice', article, true);
  yield* syncFeed(repository, 'alice', key, parsed, now);
  expect((yield* repository.article('alice', article))?.read).toBe(true);
  yield* verifyDescriptions(repository, key, article, parsed, now);
  expect(yield* repository.articles('bob', '', false, 0, 40)).toEqual([]);
  expect(yield* repository.remove('bob', key)).toBe(false);
  expect(yield* repository.remove('alice', key)).toBe(true);
  expect(yield* repository.articles('alice', '', false, 0, 40)).toEqual([]);
});

const verifyRetentionCap = Effect.gen(function* () {
  const repository = yield* FeedRepository;
  const url = 'https://example.com/rss';
  const now = new Date().toISOString();
  const feed = yield* createEmptyFeed(repository, 'alice', url, now);
  const key = feed.key;
  const firstRefreshAt = new Date(600000).toISOString();
  yield* syncFeed(repository, 'alice', key, makeParsed(500), firstRefreshAt);
  expect(yield* repository.articles('alice', '', false, 0, 600)).toHaveLength(
    500
  );
  const secondRefreshAt = new Date(1100000).toISOString();
  yield* syncFeed(
    repository,
    'alice',
    key,
    makeParsed(500, 500),
    secondRefreshAt
  );
  const retained = yield* repository.articles('alice', '', false, 0, 600);
  expect(retained).toHaveLength(500);
  expect(retained[0]?.title).toBe('999');
  expect(retained[499]?.title).toBe('500');
  expect(yield* repository.remove('alice', key)).toBe(true);
  yield* syncFeed(repository, 'alice', key, makeParsed(10), now);
  expect(yield* repository.articles('alice', '', false, 0, 10)).toEqual([]);
});

const verifyCursorPaging = Effect.gen(function* () {
  const repository = yield* FeedRepository;
  const later = new Date(40000000).toISOString();
  const feed = yield* createEmptyFeed(
    repository,
    'alice',
    'https://example.com/cursor-rss',
    later
  );
  const key = feed.key;
  yield* syncFeed(repository, 'alice', key, makeParsed(40), later);
  const first = yield* repository.articles('alice', '', false, 0, 30);
  expect(first).toHaveLength(30);
  const last = first[29];
  for (const item of first.slice(0, 3)) {
    expect(yield* repository.mark('alice', item.key, true)).toBe(true);
  }

  const cursor = yield* repository.articles(
    'alice',
    '',
    false,
    0,
    30,
    false,
    last?.publishedAt ?? '',
    last?.key ?? ''
  );
  expect(cursor).toHaveLength(10);
  expect(cursor.some((item) => first.some(({ key }) => key === item.key))).toBe(
    false
  );
  expect(yield* repository.articles('alice', '', false, 30, 30)).toHaveLength(
    7
  );
  const all = yield* repository.articles('alice', '', false, 0, 40, true);
  expect(all).toHaveLength(40);
  expect(all.some((item) => item.read)).toBe(true);
  expect(all.some((item) => !item.read)).toBe(true);
});

const verifyBulkMark = Effect.gen(function* () {
  const repository = yield* FeedRepository;
  const now = new Date().toISOString();
  const first = yield* createEmptyFeed(
    repository,
    'alice',
    'https://example.com/first-rss',
    now
  );
  const second = yield* createEmptyFeed(
    repository,
    'alice',
    'https://example.com/second-rss',
    now
  );
  const bobFeed = yield* createEmptyFeed(
    repository,
    'bob',
    'https://example.com/bob-rss',
    now
  );
  const firstKey = first.key;
  const secondKey = second.key;
  const bobKey = bobFeed.key;
  yield* syncFeed(repository, 'alice', firstKey, makeParsed(5), now);
  yield* syncFeed(repository, 'alice', secondKey, makeParsed(5, 10), now);
  yield* syncFeed(repository, 'bob', bobKey, makeParsed(5, 20), now);

  yield* repository.markAll('alice', firstKey);
  expect(yield* repository.articles('alice', firstKey, false, 0, 10)).toEqual(
    []
  );
  expect(
    yield* repository.articles('alice', secondKey, false, 0, 10)
  ).toHaveLength(5);
  expect(yield* repository.articles('bob', '', false, 0, 10)).toHaveLength(5);

  yield* repository.markAll('alice', '');
  expect(yield* repository.articles('alice', '', false, 0, 20)).toEqual([]);
  expect(yield* repository.articles('bob', '', false, 0, 10)).toHaveLength(5);

  yield* repository.markAll('bob', bobKey);
  expect(yield* repository.articles('bob', '', false, 0, 10)).toEqual([]);
});

const verifyLoadedSelection = (
  repository: FeedRepository['Service'],
  carolItems: readonly FeedArticle[],
  daveItems: readonly FeedArticle[]
) =>
  Effect.gen(function* () {
    yield* repository.markLoaded('carol', []);
    expect(yield* repository.articles('carol', '', false, 0, 10)).toHaveLength(
      4
    );
    yield* repository.markLoaded('carol', [
      carolItems[0]?.key ?? '',
      carolItems[1]?.key ?? '',
      daveItems[0]?.key ?? '',
    ]);
    expect(
      (yield* repository.articles('carol', '', false, 0, 10)).map(
        ({ key }) => key
      )
    ).toEqual([carolItems[2]?.key, carolItems[3]?.key]);
    expect(
      (yield* repository.articles('carol', '', true, 0, 10)).map(
        ({ key }) => key
      )
    ).toEqual([carolItems[0]?.key, carolItems[1]?.key]);
    expect(yield* repository.articles('dave', '', false, 0, 10)).toHaveLength(
      2
    );
  });

const verifyLoadedMark = Effect.gen(function* () {
  const repository = yield* FeedRepository;
  const now = new Date(90000000).toISOString();
  const carol = yield* createEmptyFeed(
    repository,
    'carol',
    'https://example.com/carol-rss',
    now
  );
  const dave = yield* createEmptyFeed(
    repository,
    'dave',
    'https://example.com/dave-rss',
    now
  );
  yield* syncFeed(repository, 'carol', carol.key, makeParsed(4), now);
  yield* syncFeed(repository, 'dave', dave.key, makeParsed(2, 10), now);
  const carolItems = yield* repository.articles(
    'carol',
    carol.key,
    false,
    0,
    10
  );
  const daveItems = yield* repository.articles('dave', '', false, 0, 10);
  expect(carolItems).toHaveLength(4);
  expect(daveItems).toHaveLength(2);
  yield* verifyLoadedSelection(repository, carolItems, daveItems);
});

const verifyExplicitRetention = Effect.gen(function* () {
  const repository = yield* FeedRepository;
  const createdAt = new Date(7000).toISOString();
  const created = yield* repository.createSubscribed(
    'alice',
    'https://example.com/limited-rss',
    { ...prepareInitialImport(makeParsed(5), createdAt), retention: 2 },
    createdAt
  );
  const titles = (items: readonly { title: string }[]) =>
    items.map((item) => item.title);
  expect(titles(yield* repository.articles('alice', '', false, 0, 10))).toEqual(
    ['4', '3']
  );
  const refreshedAt = new Date(8000).toISOString();
  yield* repository.sync(
    'alice',
    created.key,
    { ...prepareRefreshImport(makeParsed(4, 10), refreshedAt), retention: 3 },
    refreshedAt
  );
  expect(titles(yield* repository.articles('alice', '', false, 0, 10))).toEqual(
    ['13', '12', '11']
  );
});

it.effect('deduplicates subscriptions and articles, preserves read state', () =>
  runWithDatabase(verifyCoreFlows)
);

it.effect('pages by strict cursor after earlier articles are marked read', () =>
  runWithDatabase(verifyCursorPaging)
);

it.effect('marks unread articles for the owner and feed scope only', () =>
  runWithDatabase(verifyBulkMark)
);

it.effect(
  'caps articles at 500 and skips sync after unsubscribe',
  () => runWithDatabase(verifyRetentionCap),
  { timeout: 15000 }
);

it.effect('trims retained articles to the explicit retention cap', () =>
  runWithDatabase(verifyExplicitRetention)
);

it.effect('marks only the loaded article keys for the owning reader', () =>
  runWithDatabase(verifyLoadedMark)
);
