import { expect, it } from '@effect/vitest';
import { FeedRepository } from '@reader/business';
import { Effect } from 'effect';
import {
  createEmptyFeed,
  makeParsed,
  runWithDatabase,
} from './feed-repository-support';

const verifyDescriptions = (
  repository: FeedRepository['Service'],
  key: string,
  article: string,
  parsed: ReturnType<typeof makeParsed>,
  now: string
) =>
  Effect.gen(function* () {
    expect(
      (yield* repository.article('alice', article))?.description
    ).toBeUndefined();
    const refreshed = {
      ...parsed,
      articles: parsed.articles.map((item) => ({
        ...item,
        description: '<p>Updated</p>',
      })),
    };
    yield* repository.sync('bob', key, refreshed, false, now);
    expect(
      (yield* repository.article('alice', article))?.description
    ).toBeUndefined();
    yield* repository.sync('alice', key, refreshed, false, now);
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
  const feed = yield* repository.createSubscribed('alice', url, parsed, now);
  const key = feed.key;
  expect(feed.unreadCount).toBe(30);
  expect(yield* repository.createSubscribed('alice', url, parsed, now)).toEqual(
    feed
  );
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
  yield* repository.sync('alice', key, parsed, false, now);
  expect((yield* repository.article('alice', article))?.read).toBe(true);
  yield* verifyDescriptions(repository, key, article, parsed, now);
  expect(yield* repository.articles('bob', '', false, 0, 40)).toEqual([]);
  expect(yield* repository.remove('bob', key)).toBe(false);
  expect(yield* repository.remove('alice', key)).toBe(true);
  expect(yield* repository.articles('alice', '', false, 0, 40)).toEqual([]);
});

const verifyRetentionCap = Effect.gen(function* () {
  const repository = yield* FeedRepository;
  const feed = yield* repository.createSubscribed(
    'alice',
    'https://example.com/rss',
    makeParsed(0),
    new Date().toISOString()
  );
  const key = feed.key;
  yield* repository.sync(
    'alice',
    key,
    makeParsed(500),
    false,
    new Date(600000).toISOString()
  );
  expect(yield* repository.articles('alice', '', false, 0, 600)).toHaveLength(
    500
  );
  yield* repository.sync(
    'alice',
    key,
    makeParsed(500, 500),
    false,
    new Date(1100000).toISOString()
  );
  const retained = yield* repository.articles('alice', '', false, 0, 600);
  expect(retained).toHaveLength(500);
  expect(retained[0]?.title).toBe('999');
  expect(retained[499]?.title).toBe('500');
  expect(yield* repository.remove('alice', key)).toBe(true);
  yield* repository.sync(
    'alice',
    key,
    makeParsed(10),
    false,
    new Date().toISOString()
  );
  expect(yield* repository.articles('alice', '', false, 0, 10)).toEqual([]);
});

const verifyCursorPaging = Effect.gen(function* () {
  const repository = yield* FeedRepository;
  const url = 'https://example.com/cursor-rss';
  const later = new Date(40000000).toISOString();
  const feed = yield* createEmptyFeed(repository, 'alice', url, later);
  const key = feed.key;
  yield* repository.sync('alice', key, makeParsed(40), false, later);
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
  const first = yield* repository.createSubscribed(
    'alice',
    'https://example.com/first-rss',
    makeParsed(0),
    now
  );
  const second = yield* repository.createSubscribed(
    'alice',
    'https://example.com/second-rss',
    makeParsed(0),
    now
  );
  const bobFeed = yield* repository.createSubscribed(
    'bob',
    'https://example.com/bob-rss',
    makeParsed(0),
    now
  );
  const firstKey = first.key;
  const secondKey = second.key;
  const bobKey = bobFeed.key;
  yield* repository.sync('alice', firstKey, makeParsed(5), true, now);
  yield* repository.sync('alice', secondKey, makeParsed(5, 10), true, now);
  yield* repository.sync('bob', bobKey, makeParsed(5, 20), true, now);

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

const verifyLoadedMark = Effect.gen(function* () {
  const repository = yield* FeedRepository;
  const now = new Date(90000000).toISOString();
  const carolUrl = 'https://example.com/carol-rss';
  const daveUrl = 'https://example.com/dave-rss';
  const carol = yield* createEmptyFeed(repository, 'carol', carolUrl, now);
  const dave = yield* createEmptyFeed(repository, 'dave', daveUrl, now);
  yield* repository.sync('carol', carol.key, makeParsed(4), true, now);
  yield* repository.sync('dave', dave.key, makeParsed(2, 10), true, now);
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
  yield* repository.markLoaded('carol', []);
  expect(yield* repository.articles('carol', '', false, 0, 10)).toHaveLength(4);
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
    (yield* repository.articles('carol', '', true, 0, 10)).map(({ key }) => key)
  ).toEqual([carolItems[0]?.key, carolItems[1]?.key]);
  expect(yield* repository.articles('dave', '', false, 0, 10)).toHaveLength(2);
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

it.effect('caps articles at 500 and skips sync after unsubscribe', () =>
  runWithDatabase(verifyRetentionCap)
);

it.effect('marks only the loaded article keys for the owning reader', () =>
  runWithDatabase(verifyLoadedMark)
);
