// biome-ignore-all lint/style/noExcessiveLinesPerFile: usecase tests share one set of article fixtures and layers.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: each test declares its dependency mocks alongside the scenario.
import { expect, it } from '@effect/vitest';
import { type Context, Effect, Layer, Option, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import {
  Article,
  ArticleId,
  Feed,
  FeedId,
  OwnerId,
} from '../../src/entity/model';
import { ArticleExtractor } from '../../src/port/article-extractor';
import { ReaderCredentials } from '../../src/port/reader-credentials';
import {
  type ArticleBoundary,
  type ArticleQuery,
  Articles,
  Subscriptions,
} from '../../src/port/reader-store';
import {
  WebpageFetchError,
  WebpageFetcher,
} from '../../src/port/webpage-fetcher';
import {
  addArticle,
  countUnread,
  extractArticle,
  getArticle,
  listFeedArticles,
  listLaterArticles,
  markArticle,
  markArticlesRead,
  markFeedsRead,
  markLaterRead,
  refreshFeedArticles,
  refreshLaterArticles,
  removeArticle,
  saveArticle,
} from '../../src/usecase/articles';
import { articleId } from '../../src/usecase/identity';

const alice = OwnerId.make('alice');
const bob = OwnerId.make('bob');
const feed = FeedId.make('f'.repeat(64));
const otherFeed = FeedId.make('e'.repeat(64));
const firstId = ArticleId.make('a'.repeat(64));
const secondId = ArticleId.make('b'.repeat(64));
const now = Date.UTC(2026, 0, 1, 12);

const makeArticle = (overrides: Record<string, unknown> = {}): Article =>
  Schema.decodeUnknownSync(Article)({
    id: firstId,
    ownerId: alice,
    title: 'Title',
    publishedAt: '2026-01-01T00:00:00.000Z',
    read: false,
    ...overrides,
  });

const encodedTime = (article: Article): string =>
  Schema.encodeSync(Schema.DateTimeUtcFromString)(article.publishedAt);

const hex = (value: number): string => value.toString(16).padStart(64, '0');

const series = (count: number): Article[] =>
  Array.from({ length: count }, (_, index) =>
    makeArticle({
      id: hex(index),
      title: `Article ${index}`,
      publishedAt: new Date(now + index * 60_000).toISOString(),
    })
  );

/**
 * Fake listing store keeping `items` in list order: `after` is the exclusive
 * suffix past the boundary, `through` the inclusive prefix up to it. The
 * boundary is matched by its (publishedAt, id) tuple, so a removed boundary
 * article still bounds the returned page.
 */
const pagedStore =
  (items: readonly Article[]) => (_owner: OwnerId, query: ArticleQuery) => {
    const isLaterThan = (item: Article, boundary: ArticleBoundary): boolean => {
      const publishedAt = encodedTime(item);

      return (
        publishedAt > boundary.publishedAt ||
        (publishedAt === boundary.publishedAt && item.id > boundary.id)
      );
    };

    return Effect.succeed(
      items
        .filter(
          (item) =>
            (query.after === undefined || isLaterThan(item, query.after)) &&
            (query.through === undefined || !isLaterThan(item, query.through))
        )
        .slice(0, query.limit)
    );
  };

const subscription = (id: FeedId): Feed =>
  Schema.decodeUnknownSync(Feed)({
    id,
    ownerId: alice,
    url: 'https://example.com/feed.xml',
    title: 'Feed',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

const provide = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layers: {
    readonly articles?: Partial<Context.Service.Shape<typeof Articles>>;
    readonly credentials?: Partial<
      Context.Service.Shape<typeof ReaderCredentials>
    >;
    readonly fetcher?: Partial<Context.Service.Shape<typeof WebpageFetcher>>;
    readonly extractor?: Partial<
      Context.Service.Shape<typeof ArticleExtractor>
    >;
    readonly subscriptions?: Partial<
      Context.Service.Shape<typeof Subscriptions>
    >;
  }
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(Articles, layers.articles ?? {}),
        Layer.mock(ReaderCredentials, layers.credentials ?? {}),
        Layer.mock(WebpageFetcher, layers.fetcher ?? {}),
        Layer.mock(ArticleExtractor, layers.extractor ?? {}),
        Layer.mock(Subscriptions, layers.subscriptions ?? {})
      )
    )
  );

const jinaCredentials = () => ({
  provider: () => Effect.succeed('jina' as const),
  get: () => Effect.undefined,
});

it.effect('gets an article scoped to the requesting owner', () => {
  const item = makeArticle();
  const calls: (readonly [OwnerId, ArticleId])[] = [];

  return provide(
    Effect.gen(function* () {
      expect(yield* getArticle(alice, item.id)).toEqual(Option.some(item));
      expect(yield* getArticle(bob, item.id)).toEqual(Option.none());
      expect(calls).toEqual([
        [alice, item.id],
        [bob, item.id],
      ]);
    }),
    {
      articles: {
        find: (owner, id) => {
          calls.push([owner, id]);

          return Effect.succeed(
            owner === alice ? Option.some(item) : Option.none()
          );
        },
      },
    }
  );
});

it.effect('adds an anonymous Jina article with normalized URL and body', () => {
  let saved: Article | undefined;

  return provide(
    Effect.gen(function* () {
      yield* TestClock.setTime(now);
      const result = yield* addArticle(
        alice,
        'https://Example.com/post?utm_source=x'
      );
      expect(result.item.title).toBe('Untitled');
      expect(result.item.url?.href).toBe('https://example.com/post');
      expect(result.item.content).toBe('<p>Body</p>');
      expect(result.item.extractedContent).toBe('<p>Body</p>');
      expect(result.item.ownerId).toBe(alice);
      expect(result.item.feedId).toBeUndefined();
      expect(result.item.read).toBe(false);
      expect(encodedTime(result.item)).toBe('2026-01-01T12:00:00.000Z');
      expect(saved).toEqual(result.item);
    }),
    {
      articles: {
        create: (owner, items) => {
          expect(owner).toBe(alice);
          saved = items[0];

          return Effect.succeed(items.map((item) => item.id));
        },
      },
      credentials: jinaCredentials(),
      fetcher: {
        fetch: (url, key, provider, endpoint) => {
          expect([url, key, provider, endpoint]).toEqual([
            'https://example.com/post',
            undefined,
            'jina',
            undefined,
          ]);

          return Effect.succeed('<html>raw</html>');
        },
      },
      extractor: {
        extract: (html, url) => {
          expect([html, url]).toEqual([
            '<html>raw</html>',
            'https://example.com/post',
          ]);

          return Effect.succeed({ title: '  ', html: '<p>Body</p>' });
        },
      },
    }
  );
});

it.effect('keeps extracted description and published date when adding', () => {
  const url = new URL('https://example.com/post');
  const publishedAt = Schema.decodeUnknownSync(Schema.DateTimeUtcFromString)(
    '2024-05-06T07:08:09.000Z'
  );
  let saved: Article | undefined;

  return provide(
    Effect.gen(function* () {
      yield* TestClock.setTime(now);
      const result = yield* addArticle(alice, url.href);
      expect(result.item.title).toBe('Post');
      expect(result.item.description).toBe('Summary');
      expect(encodedTime(result.item)).toBe('2024-05-06T07:08:09.000Z');
      expect(result.item.id).toBe(
        articleId(alice, undefined, url, 'Post', 'Summary')
      );
      expect(saved).toEqual(result.item);
    }),
    {
      articles: {
        create: (_owner, items) => {
          saved = items[0];

          return Effect.succeed(items.map((item) => item.id));
        },
      },
      credentials: jinaCredentials(),
      fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
      extractor: {
        extract: () =>
          Effect.succeed({
            title: 'Post',
            html: '<p>Body</p>',
            description: 'Summary',
            publishedAt,
          }),
      },
    }
  );
});

it.effect(
  'derives distinct identities for one url when metadata differs',
  () => {
    const url = new URL('https://example.com/post');
    const ids: ArticleId[] = [];
    let attempt = 0;

    return provide(
      Effect.gen(function* () {
        yield* TestClock.setTime(now);
        yield* addArticle(alice, url.href);
        yield* addArticle(alice, url.href);
        expect(ids).toEqual([
          articleId(alice, undefined, url, 'Post', 'Summary 1'),
          articleId(alice, undefined, url, 'Post', 'Summary 2'),
        ]);
        expect(ids[0]).not.toBe(ids[1]);
      }),
      {
        articles: {
          create: (_owner, items) => {
            ids.push(...items.map((item) => item.id));

            return Effect.succeed(items.map((item) => item.id));
          },
        },
        credentials: jinaCredentials(),
        fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
        extractor: {
          extract: () => {
            attempt += 1;

            return Effect.succeed({
              title: 'Post',
              html: '<p>Body</p>',
              description: `Summary ${attempt}`,
            });
          },
        },
      }
    );
  }
);

it.effect('reports duplicate additions with the derived article id', () => {
  let attempted: Article | undefined;

  return provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        addArticle(alice, 'https://example.com/post')
      );
      expect(error._tag).toBe('DuplicateArticle');
      expect(error._tag === 'DuplicateArticle' && error.id).toBe(attempted?.id);
    }),
    {
      articles: {
        create: (_owner, items) => {
          attempted = items[0];

          return Effect.succeed([]);
        },
      },
      credentials: jinaCredentials(),
      fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
      extractor: {
        extract: () => Effect.succeed({ title: 'Post', html: '<p>Body</p>' }),
      },
    }
  );
});

it.effect('rejects an empty extracted body without saving', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        addArticle(alice, 'https://example.com/post')
      );
      expect(error._tag).toBe('ArticleEmptyContent');
    }),
    {
      articles: { create: () => Effect.die('must not save an empty article') },
      credentials: jinaCredentials(),
      fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
      extractor: {
        extract: () => Effect.succeed({ title: 'Post', html: '   ' }),
      },
    }
  )
);

it.effect('rejects malformed article URLs before contacting providers', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(addArticle(alice, 'not a url'));
      expect(error._tag).toBe('InvalidArticleUrl');
    }),
    {
      articles: {},
      credentials: { provider: () => Effect.die('must not read credentials') },
      fetcher: { fetch: () => Effect.die('must not fetch') },
      extractor: { extract: () => Effect.die('must not extract') },
    }
  )
);

it.effect('preserves fetch failure codes while adding', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        addArticle(alice, 'https://example.com/post')
      );
      expect(error._tag).toBe('WebpageFetchError');
      expect(error._tag === 'WebpageFetchError' && error.code).toBe(
        'rate_limited'
      );
    }),
    {
      articles: {},
      credentials: jinaCredentials(),
      fetcher: {
        fetch: () =>
          Effect.fail(
            new WebpageFetchError({ error: 'limited', code: 'rate_limited' })
          ),
      },
      extractor: {},
    }
  )
);

it.effect('saves a feed article copy without fetching or extracting', () => {
  const source = makeArticle({
    feedId: feed,
    url: 'https://example.com/a',
    description: 'Summary',
    content: '<p>Feed</p>',
    read: true,
  });
  let created: Article | undefined;

  return provide(
    Effect.gen(function* () {
      const result = yield* saveArticle(alice, source.id);
      expect(result.item.id).not.toBe(source.id);
      expect(result.item.feedId).toBeUndefined();
      expect(result.item.url?.href).toBe('https://example.com/a');
      expect(result.item.title).toBe(source.title);
      expect(result.item.description).toBe('Summary');
      expect(result.item.content).toBe('<p>Feed</p>');
      expect(result.item.publishedAt).toEqual(source.publishedAt);
      expect(result.item.read).toBe(false);
      expect(source.read).toBe(true);
      expect(created).toEqual(result.item);
    }),
    {
      articles: {
        find: () => Effect.succeed(Option.some(source)),
        create: (_owner, items) => {
          created = items[0];

          return Effect.succeed(items.map((item) => item.id));
        },
      },
      credentials: { provider: () => Effect.die('must not read credentials') },
      fetcher: { fetch: () => Effect.die('must not fetch') },
      extractor: { extract: () => Effect.die('must not extract') },
    }
  );
});

it.effect('keeps extracted content on the saved copy and the source', () => {
  const source = makeArticle({
    feedId: feed,
    url: 'https://example.com/a',
    content: '<p>Feed</p>',
    extractedContent: '<p>Extracted</p>',
    read: true,
  });
  const snapshot = { ...source };
  let created: Article | undefined;

  return provide(
    Effect.gen(function* () {
      const result = yield* saveArticle(alice, source.id);
      expect(result.item.extractedContent).toBe('<p>Extracted</p>');
      expect(result.item.read).toBe(false);
      expect(created?.extractedContent).toBe('<p>Extracted</p>');
      expect(source).toEqual(snapshot);
    }),
    {
      articles: {
        find: () => Effect.succeed(Option.some(source)),
        create: (_owner, items) => {
          created = items[0];

          return Effect.succeed(items.map((item) => item.id));
        },
      },
      extractor: { extract: () => Effect.die('must not extract') },
    }
  );
});

it.effect('distinguishes missing and already-later articles when saving', () =>
  provide(
    Effect.gen(function* () {
      const missing = yield* Effect.flip(saveArticle(alice, firstId));
      expect(missing._tag).toBe('ArticleNotFound');
      const later = yield* Effect.flip(saveArticle(alice, secondId));
      expect(later._tag).toBe('ArticleNotInFeed');
    }),
    {
      articles: {
        find: (owner, id) => {
          expect(owner).toBe(alice);

          return Effect.succeed(
            id === secondId
              ? Option.some(makeArticle({ id: secondId }))
              : Option.none()
          );
        },
        create: () => Effect.die('must not save'),
      },
    }
  )
);

it.effect('reports a duplicate saved copy with its id', () => {
  const source = makeArticle({ feedId: feed, url: 'https://example.com/a' });
  let attempted: Article | undefined;

  return provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(saveArticle(alice, source.id));
      expect(error._tag).toBe('DuplicateArticle');
      expect(error._tag === 'DuplicateArticle' && error.id).toBe(attempted?.id);
    }),
    {
      articles: {
        find: () => Effect.succeed(Option.some(source)),
        create: (_owner, items) => {
          attempted = items[0];

          return Effect.succeed([]);
        },
      },
    }
  );
});

it.effect(
  'returns existing extracted content without external requests',
  () => {
    const article = makeArticle({
      url: 'https://example.com/a',
      extractedContent: '<p>Cached</p>',
    });

    return provide(
      Effect.gen(function* () {
        expect(yield* extractArticle(alice, article.id)).toEqual({
          content: '<p>Cached</p>',
        });
      }),
      {
        articles: { find: () => Effect.succeed(Option.some(article)) },
        credentials: {
          provider: () => Effect.die('must not read credentials'),
        },
        fetcher: { fetch: () => Effect.die('must not fetch') },
        extractor: { extract: () => Effect.die('must not extract') },
      }
    );
  }
);

it.effect('rejects extraction when the article has no URL', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(extractArticle(alice, firstId));
      expect(error._tag).toBe('ArticleMissingUrl');
    }),
    {
      articles: {
        find: () => Effect.succeed(Option.some(makeArticle())),
      },
      credentials: { provider: () => Effect.die('must not read credentials') },
      fetcher: { fetch: () => Effect.die('must not fetch') },
    }
  )
);

it.effect('extracts, persists, and returns an article body', () => {
  const article = makeArticle({ url: 'https://example.com/a' });
  const saved: (readonly [OwnerId, ArticleId, string])[] = [];

  return provide(
    Effect.gen(function* () {
      expect(yield* extractArticle(alice, article.id)).toEqual({
        content: '<p>Fresh</p>',
      });
      expect(saved).toEqual([[alice, article.id, '<p>Fresh</p>']]);
    }),
    {
      articles: {
        find: () => Effect.succeed(Option.some(article)),
        saveExtracted: (owner, id, content) => {
          saved.push([owner, id, content]);

          return Effect.succeed(true);
        },
      },
      credentials: jinaCredentials(),
      fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
      extractor: {
        extract: () => Effect.succeed({ title: 'Fresh', html: '<p>Fresh</p>' }),
      },
    }
  );
});

it.effect('treats a deleted article as missing after extraction', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(extractArticle(alice, firstId));
      expect(error._tag).toBe('ArticleNotFound');
    }),
    {
      articles: {
        find: () =>
          Effect.succeed(
            Option.some(makeArticle({ url: 'https://example.com/a' }))
          ),
        saveExtracted: () => Effect.succeed(false),
      },
      credentials: jinaCredentials(),
      fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
      extractor: {
        extract: () => Effect.succeed({ title: 'Fresh', html: '<p>Fresh</p>' }),
      },
    }
  )
);

it.effect('preserves fetch failure codes while extracting', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(extractArticle(alice, firstId));
      expect(error._tag).toBe('WebpageFetchError');
      expect(error._tag === 'WebpageFetchError' && error.code).toBe(
        'key_rejected'
      );
    }),
    {
      articles: {
        find: () =>
          Effect.succeed(
            Option.some(makeArticle({ url: 'https://example.com/a' }))
          ),
      },
      credentials: jinaCredentials(),
      fetcher: {
        fetch: () =>
          Effect.fail(
            new WebpageFetchError({ error: 'rejected', code: 'key_rejected' })
          ),
      },
      extractor: {},
    }
  )
);

it.effect('marks articles through the owner-scoped store operations', () => {
  const calls: unknown[] = [];

  return provide(
    Effect.gen(function* () {
      expect(yield* markArticle(alice, firstId, false)).toEqual({ ok: true });
      expect(yield* markLaterRead(alice)).toEqual({ ok: true });
      expect(yield* markFeedsRead(alice, [feed, otherFeed])).toEqual({
        ok: true,
      });
      expect(yield* markArticlesRead(alice, [firstId, secondId])).toEqual({
        ok: true,
      });
      expect(calls).toEqual([
        ['setRead', alice, [firstId], false],
        ['markLater', alice],
        ['markFeeds', alice, [feed, otherFeed]],
        ['setRead', alice, [firstId, secondId], true],
      ]);
    }),
    {
      articles: {
        setRead: (owner, ids, read) => {
          calls.push(['setRead', owner, ids, read]);

          return Effect.void;
        },
        markLater: (owner) => {
          calls.push(['markLater', owner]);

          return Effect.void;
        },
        markFeeds: (owner, ids) => {
          calls.push(['markFeeds', owner, ids]);

          return Effect.void;
        },
      },
    }
  );
});

it.effect(
  'removes only later articles and treats unknown ids as success',
  () => {
    const removed: ArticleId[] = [];

    return provide(
      Effect.gen(function* () {
        expect(yield* removeArticle(alice, firstId)).toEqual({ ok: true });
        expect(yield* removeArticle(alice, secondId)).toEqual({ ok: true });
        const feedError = yield* Effect.flip(
          removeArticle(alice, ArticleId.make('c'.repeat(64)))
        );
        expect(feedError._tag).toBe('ArticleNotLater');
        expect(removed).toEqual([firstId]);
      }),
      {
        articles: {
          find: (_owner, id) => {
            if (id === firstId) {
              return Effect.succeed(Option.some(makeArticle()));
            }

            if (id === secondId) {
              return Effect.succeed(Option.none());
            }

            return Effect.succeed(Option.some(makeArticle({ feedId: feed })));
          },
          removeLater: (_owner, id) => {
            removed.push(id);

            return Effect.void;
          },
        },
      }
    );
  }
);

it.effect('pages thirty later articles and continues from the cursor', () => {
  const items = series(31);
  const calls: ArticleQuery[] = [];

  return provide(
    Effect.gen(function* () {
      const first = yield* listLaterArticles(alice, 'all');
      expect(first.items.map((item) => item.id)).toEqual(
        items.slice(0, 30).map((item) => item.id)
      );
      expect(first.cursor).not.toBeNull();
      expect(first.boundary).toBe(first.cursor);
      expect(calls[0]).toEqual({
        scope: { kind: 'later' },
        filter: 'all',
        limit: 31,
      });
      const second = yield* listLaterArticles(
        alice,
        'all',
        first.cursor ?? undefined
      );
      expect(second.items).toEqual([items[30]]);
      expect(second.cursor).toBeNull();
      expect(second.boundary).toEqual(expect.any(String));
      expect(second.boundary).not.toBe(first.cursor);
      expect(calls[1]).toEqual({
        scope: { kind: 'later' },
        filter: 'all',
        limit: 31,
        after: {
          id: items[29]?.id,
          publishedAt: encodedTime(items[29] as Article),
        },
      });
    }),
    {
      articles: {
        list: (owner, query) => {
          calls.push(query);

          return pagedStore(items)(owner, query);
        },
      },
    }
  );
});

it.effect('binds cursors to owner, scope, and filter', () => {
  const items = series(31);

  return provide(
    Effect.gen(function* () {
      const page = yield* listLaterArticles(alice, 'all');
      const cursor = page.cursor ?? '';
      const decoded = yield* listLaterArticles(alice, 'all', cursor);
      expect(decoded.items).toEqual([items[30]]);

      for (const attempt of [
        listLaterArticles(bob, 'all', cursor),
        listLaterArticles(alice, 'unread', cursor),
        listFeedArticles(alice, undefined, 'all', cursor),
        listLaterArticles(alice, 'all', 'not-a-cursor'),
        listLaterArticles(alice, 'all', btoa('{"version":1}')),
      ]) {
        expect((yield* Effect.flip(attempt))._tag).toBe('InvalidCursor');
      }
    }),
    { articles: { list: pagedStore(items) } }
  );
});

it.effect('lists feed articles in feed or all-feed scope', () => {
  const calls: ArticleQuery[] = [];
  const checks: (readonly [OwnerId, FeedId])[] = [];

  return provide(
    Effect.gen(function* () {
      yield* listFeedArticles(alice, feed, 'unread');
      yield* listFeedArticles(alice, undefined, 'read');
      expect(calls.map((call) => call.scope)).toEqual([
        { kind: 'feeds', feedId: feed },
        { kind: 'feeds' },
      ]);
      expect(checks).toEqual([[alice, feed]]);
    }),
    {
      articles: {
        list: (_owner, query) => {
          calls.push(query);

          return Effect.succeed([]);
        },
      },
      subscriptions: {
        find: (owner, id) => {
          checks.push([owner, id]);

          return Effect.succeed(Option.some(subscription(id)));
        },
      },
    }
  );
});

it.effect('refreshes through the original boundary article inclusively', () => {
  const items = series(80);
  const calls: ArticleQuery[] = [];

  return provide(
    Effect.gen(function* () {
      const first = yield* listLaterArticles(alice, 'all');
      const second = yield* listLaterArticles(
        alice,
        'all',
        first.cursor ?? undefined
      );
      const boundary = second.boundary ?? '';
      const refreshed = yield* refreshLaterArticles(alice, 'all', boundary);
      expect(refreshed.map((item) => item.id)).toEqual(
        items.slice(0, 60).map((item) => item.id)
      );
      expect(calls.slice(-2)).toEqual([
        {
          scope: { kind: 'later' },
          filter: 'all',
          limit: 31,
          through: {
            id: items[59]?.id,
            publishedAt: encodedTime(items[59] as Article),
          },
        },
        {
          scope: { kind: 'later' },
          filter: 'all',
          limit: 31,
          through: {
            id: items[59]?.id,
            publishedAt: encodedTime(items[59] as Article),
          },
          after: {
            id: items[30]?.id,
            publishedAt: encodedTime(items[30] as Article),
          },
        },
      ]);
    }),
    {
      articles: {
        list: (owner, query) => {
          calls.push(query);

          return pagedStore(items)(owner, query);
        },
      },
    }
  );
});

it.effect('keeps a tail boundary on a final page without a cursor', () => {
  const items = series(5);

  return provide(
    Effect.gen(function* () {
      const page = yield* listLaterArticles(alice, 'all');
      expect(page.items).toEqual(items);
      expect(page.cursor).toBeNull();
      expect(page.boundary).toEqual(expect.any(String));
      const refreshed = yield* refreshLaterArticles(
        alice,
        'all',
        page.boundary ?? ''
      );
      expect(refreshed.map((item) => item.id)).toEqual(
        items.map((item) => item.id)
      );
    }),
    { articles: { list: pagedStore(items) } }
  );
});

it.effect('reports no boundary for an empty page', () =>
  provide(
    Effect.gen(function* () {
      expect(yield* listLaterArticles(alice, 'all')).toEqual({
        items: [],
        cursor: null,
        boundary: null,
      });
    }),
    { articles: { list: () => Effect.succeed([]) } }
  )
);

it.effect('refreshes from a boundary whose article was removed', () => {
  const items = series(40);
  const calls: ArticleQuery[] = [];
  let stored = items;

  return provide(
    Effect.gen(function* () {
      const first = yield* listLaterArticles(alice, 'all');
      const second = yield* listLaterArticles(
        alice,
        'all',
        first.cursor ?? undefined
      );
      expect(second.cursor).toBeNull();
      stored = items.filter((item) => item.id !== items[39]?.id);
      const refreshed = yield* refreshLaterArticles(
        alice,
        'all',
        second.boundary ?? ''
      );
      expect(refreshed.map((item) => item.id)).toEqual(
        items.slice(0, 39).map((item) => item.id)
      );
      expect(calls.at(-1)?.through).toEqual({
        id: items[39]?.id,
        publishedAt: encodedTime(items[39] as Article),
      });
    }),
    {
      articles: {
        list: (owner, query) => {
          calls.push(query);

          return pagedStore(stored)(owner, query);
        },
      },
    }
  );
});

it.effect('rejects feed pages once the feed no longer exists', () => {
  const items = series(5);
  let exists = true;

  return provide(
    Effect.gen(function* () {
      const page = yield* listFeedArticles(alice, feed, 'all');
      exists = false;
      const listError = yield* Effect.flip(
        listFeedArticles(alice, feed, 'all')
      );
      expect(listError._tag).toBe('SubscriptionNotFound');
      expect(listError._tag === 'SubscriptionNotFound' && listError.id).toBe(
        feed
      );
      const refreshError = yield* Effect.flip(
        refreshFeedArticles(alice, feed, 'all', page.boundary ?? '')
      );
      expect(refreshError._tag).toBe('SubscriptionNotFound');
    }),
    {
      articles: { list: pagedStore(items) },
      subscriptions: {
        find: (owner, id) => {
          expect([owner, id]).toEqual([alice, feed]);

          return Effect.succeed(
            exists ? Option.some(subscription(id)) : Option.none()
          );
        },
      },
    }
  );
});

it.effect('counts unread later and feed articles from the store', () =>
  provide(
    Effect.gen(function* () {
      expect(yield* countUnread(alice)).toEqual({
        later: 2,
        feeds: [{ id: feed, count: 3 }],
        total: 5,
      });
    }),
    {
      articles: {
        unreadLater: () => Effect.succeed(2),
        unreadFeeds: () =>
          Effect.succeed({ total: 3, feeds: [{ id: feed, count: 3 }] }),
      },
    }
  )
);
