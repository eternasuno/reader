// biome-ignore-all lint/style/noExcessiveLinesPerFile: usecase tests share one set of article fixtures and layers.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: each test declares its dependency mocks alongside the scenario.
import { expect, it } from '@effect/vitest';
import { type Context, Effect, Layer, Option, Schema } from 'effect';
import { Article, ArticleId } from '../../src/entity/article';
import { Feed } from '../../src/entity/feed';
import { FeedId, OwnerId } from '../../src/entity/object-value';
import { ArticleExtractor } from '../../src/port/article-extractor';
import {
  type ArticleBoundary,
  type ArticlePatch,
  type ArticleQuery,
  ArticleRepository,
} from '../../src/port/article-repository';
import { FeedRepository } from '../../src/port/feed-repository';
import { HtmlParser, HtmlParserError } from '../../src/port/html-parser';
import {
  WebpageFetcher,
  WebpageFetcherError,
  WebpageFetcherLayer,
} from '../../src/port/webpage-fetcher';
import {
  addArticle,
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

const extractedPublishedAt = Schema.decodeSync(Schema.DateTimeUtcFromString)(
  '2024-05-06T07:08:09.000Z'
);

const makeArticle = (overrides: Record<string, unknown> = {}): Article =>
  Schema.decodeUnknownSync(Article)({
    id: firstId,
    ownerId: alice,
    title: 'Title',
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    read: false,
    ...overrides,
  });

const encodedTime = (article: Article): string =>
  Schema.encodeSync(Schema.DateTimeUtcFromString)(article.publishedAt);

const hex = (value: number): string => value.toString(16).padStart(64, '0');

const series = (count: number): Array<Article> =>
  Array.from({ length: count }, (_, index) =>
    makeArticle({
      id: hex(index),
      title: `Article ${index}`,
      publishedAt: new Date(now + index * 60_000),
    })
  );

/**
 * Fake listing store keeping `items` in list order: `after` is the exclusive
 * suffix past the boundary, `through` the inclusive prefix up to it. The
 * boundary is matched by its (publishedAt, id) tuple, so a removed boundary
 * article still bounds the returned page.
 */
const pagedStore =
  (items: ReadonlyArray<Article>) => (_owner: OwnerId, query: ArticleQuery) => {
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

const pagedArticles = (items: ReadonlyArray<Article>) => ({
  listLater: (owner: OwnerId, query: ArticleQuery) =>
    pagedStore(items)(owner, query),
  listFeeds: (
    owner: OwnerId,
    _feedIds: Option.Option<ReadonlyArray<FeedId>>,
    query: ArticleQuery
  ) => pagedStore(items)(owner, query),
});

const subscription = (id: FeedId): Feed =>
  Schema.decodeUnknownSync(Feed)({
    id,
    ownerId: alice,
    url: 'https://example.com/feed.xml',
    title: 'Feed',
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

const parsedDocument = (html = ''): Document =>
  ({ body: { innerHTML: html } }) as unknown as Document;

const provide = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layers: {
    readonly articles?: Partial<
      Context.Service.Shape<typeof ArticleRepository>
    >;
    readonly fetcher?: Partial<Context.Service.Shape<typeof WebpageFetcher>>;
    readonly parser?: Partial<Context.Service.Shape<typeof HtmlParser>>;
    readonly extractor?: Partial<
      Context.Service.Shape<typeof ArticleExtractor>
    >;
    readonly subscriptions?: Partial<
      Context.Service.Shape<typeof FeedRepository>
    >;
  },
  _owner: OwnerId = alice
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ArticleRepository, layers.articles ?? {}),
        Layer.succeed(
          WebpageFetcherLayer,
          Layer.mock(WebpageFetcher, layers.fetcher ?? {})
        ),
        Layer.mock(HtmlParser, {
          parse: () => Effect.succeed(parsedDocument()),
          ...layers.parser,
        }),
        Layer.mock(ArticleExtractor, layers.extractor ?? {}),
        Layer.mock(FeedRepository, layers.subscriptions ?? {})
      )
    )
  );

it.effect('gets an article scoped to the requesting owner', () => {
  const item = makeArticle();
  const calls: Array<readonly [OwnerId, ArticleId]> = [];

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
  const document = parsedDocument('<p>Body</p>');
  let saved: Article | undefined;

  return provide(
    Effect.gen(function* () {
      const result = yield* addArticle(
        alice,
        'https://Example.com/post?utm_source=x'
      );
      expect(result.item.title).toBe('Untitled');
      expect(result.item.url).toEqual(
        Option.some(new URL('https://example.com/post'))
      );
      expect(result.item.description).toEqual(Option.some(''));
      expect(result.item.content).toEqual(Option.some('<p>Body</p>'));
      expect(result.item.extractedContent).toEqual(Option.some('<p>Body</p>'));
      expect(result.item.ownerId).toBe(alice);
      expect(result.item.feedId).toEqual(Option.none());
      expect(result.item.read).toBe(false);
      expect(encodedTime(result.item)).toBe('2024-05-06T07:08:09.000Z');
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
      fetcher: {
        fetch: (url) => {
          expect(url).toBe('https://example.com/post');

          return Effect.succeed('<html>raw</html>');
        },
      },
      parser: {
        parse: (html, url) => {
          expect(html).toBe('<html>raw</html>');
          expect(url?.href).toBe('https://example.com/post');

          return Effect.succeed(document);
        },
      },
      extractor: {
        extract: (received) => {
          expect(received).toBe(document);

          return Effect.succeed({
            title: '  ',
            description: Option.some(''),
            content: Option.some('<p>Body</p>'),
            publishedAt: extractedPublishedAt,
          });
        },
      },
    }
  );
});

it.effect('keeps extracted description and published date when adding', () => {
  const url = new URL('https://example.com/post');
  let saved: Article | undefined;

  return provide(
    Effect.gen(function* () {
      const result = yield* addArticle(alice, url.href);
      expect(result.item.title).toBe('Post');
      expect(result.item.description).toEqual(Option.some('Summary'));
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
      fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
      extractor: {
        extract: () =>
          Effect.succeed({
            title: 'Post',
            content: Option.some('<p>Body</p>'),
            description: Option.some('Summary'),
            publishedAt: extractedPublishedAt,
          }),
      },
    }
  );
});

it.effect(
  'derives distinct identities for one url when metadata differs',
  () => {
    const url = new URL('https://example.com/post');
    const ids: Array<ArticleId> = [];
    let attempt = 0;

    return provide(
      Effect.gen(function* () {
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
        fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
        extractor: {
          extract: () => {
            attempt += 1;

            return Effect.succeed({
              title: 'Post',
              content: Option.some('<p>Body</p>'),
              description: Option.some(`Summary ${attempt}`),
              publishedAt: extractedPublishedAt,
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
      fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
      extractor: {
        extract: () =>
          Effect.succeed({
            title: 'Post',
            content: Option.some('<p>Body</p>'),
            description: Option.some(''),
            publishedAt: extractedPublishedAt,
          }),
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
      fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
      extractor: {
        extract: () =>
          Effect.succeed({
            title: 'Post',
            description: Option.some(''),
            content: Option.some('   '),
            publishedAt: extractedPublishedAt,
          }),
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
      fetcher: { fetch: () => Effect.die('must not fetch') },
      extractor: { extract: () => Effect.die('must not extract') },
    }
  )
);

it.effect('preserves fetch failure messages while adding', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        addArticle(alice, 'https://example.com/post')
      );
      expect(error._tag).toBe('WebpageFetcherError');
      expect(error._tag === 'WebpageFetcherError' && error.message).toBe(
        'limited'
      );
    }),
    {
      articles: {},
      fetcher: {
        fetch: () =>
          Effect.fail(new WebpageFetcherError({ message: 'limited' })),
      },
      extractor: {},
    }
  )
);

it.effect('maps parser failures to extraction errors while adding', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        addArticle(alice, 'https://example.com/post')
      );
      expect(error._tag).toBe('ArticleExtractorError');
      expect(error._tag === 'ArticleExtractorError' && error.message).toBe(
        'Unable to extract article content; open the original page'
      );
    }),
    {
      articles: { create: () => Effect.die('must not save') },
      fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
      parser: {
        parse: () =>
          Effect.fail(new HtmlParserError({ message: 'malformed markup' })),
      },
      extractor: { extract: () => Effect.die('must not extract') },
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
      expect(result.item.feedId).toEqual(Option.none());
      expect(result.item.url).toEqual(
        Option.some(new URL('https://example.com/a'))
      );
      expect(result.item.title).toBe(source.title);
      expect(result.item.description).toEqual(Option.some('Summary'));
      expect(result.item.content).toEqual(Option.some('<p>Feed</p>'));
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
      expect(result.item.extractedContent).toEqual(
        Option.some('<p>Extracted</p>')
      );
      expect(result.item.read).toBe(false);
      expect(created?.extractedContent).toEqual(
        Option.some('<p>Extracted</p>')
      );
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
          item: article,
        });
      }),
      {
        articles: { find: () => Effect.succeed(Option.some(article)) },
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
      fetcher: { fetch: () => Effect.die('must not fetch') },
    }
  )
);

it.effect('extracts, persists, and returns an article body', () => {
  const article = makeArticle({ url: 'https://example.com/a' });
  const saved: Array<
    readonly [OwnerId, ReadonlyArray<ArticleId>, ArticlePatch]
  > = [];

  return provide(
    Effect.gen(function* () {
      expect(yield* extractArticle(alice, article.id)).toEqual({
        item: { ...article, extractedContent: Option.some('<p>Fresh</p>') },
      });
      expect(saved).toEqual([
        [
          alice,
          [article.id],
          { extractedContent: Option.some('<p>Fresh</p>') },
        ],
      ]);
    }),
    {
      articles: {
        find: () => Effect.succeed(Option.some(article)),
        updateByArticleIds: (owner, ids, articlePatch) => {
          saved.push([owner, ids, articlePatch]);

          return Effect.succeed(ids);
        },
      },
      fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
      extractor: {
        extract: () =>
          Effect.succeed({
            title: 'Fresh',
            description: Option.some(''),
            content: Option.some('<p>Fresh</p>'),
            publishedAt: extractedPublishedAt,
          }),
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
        updateByArticleIds: () => Effect.succeed([]),
      },
      fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
      extractor: {
        extract: () =>
          Effect.succeed({
            title: 'Fresh',
            description: Option.some(''),
            content: Option.some('<p>Fresh</p>'),
            publishedAt: extractedPublishedAt,
          }),
      },
    }
  )
);

it.effect('preserves fetch failure messages while extracting', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(extractArticle(alice, firstId));
      expect(error._tag).toBe('WebpageFetcherError');
      expect(error._tag === 'WebpageFetcherError' && error.message).toBe(
        'rejected'
      );
    }),
    {
      articles: {
        find: () =>
          Effect.succeed(
            Option.some(makeArticle({ url: 'https://example.com/a' }))
          ),
      },
      fetcher: {
        fetch: () =>
          Effect.fail(new WebpageFetcherError({ message: 'rejected' })),
      },
      extractor: {},
    }
  )
);

it.effect('patches articles through owner-scoped repository operations', () => {
  const calls: Array<unknown> = [];

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
        ['updateByArticleIds', alice, [firstId], { read: false }],
        ['updateLater', alice, { read: true }],
        ['updateFeeds', alice, Option.some([feed, otherFeed]), { read: true }],
        ['updateByArticleIds', alice, [firstId, secondId], { read: true }],
      ]);
    }),
    {
      articles: {
        updateByArticleIds: (owner, ids, articlePatch) => {
          calls.push(['updateByArticleIds', owner, ids, articlePatch]);

          return Effect.succeed(ids);
        },
        updateLater: (owner, articlePatch) => {
          calls.push(['updateLater', owner, articlePatch]);

          return Effect.succeed([]);
        },
        updateFeeds: (owner, feedIds, articlePatch) => {
          calls.push(['updateFeeds', owner, feedIds, articlePatch]);

          return Effect.succeed([]);
        },
      },
    }
  );
});

it.effect('forwards an empty feed selection when marking feeds read', () => {
  const calls: Array<unknown> = [];

  return provide(
    Effect.gen(function* () {
      expect(yield* markFeedsRead(alice, [])).toEqual({ ok: true });
      expect(calls).toEqual([
        ['updateFeeds', alice, Option.some([]), { read: true }],
      ]);
    }),
    {
      articles: {
        updateFeeds: (owner, feedIds, articlePatch) => {
          calls.push(['updateFeeds', owner, feedIds, articlePatch]);

          return Effect.succeed([]);
        },
      },
    }
  );
});

it.effect(
  'removes only later articles and treats unknown ids as success',
  () => {
    const removed: Array<ArticleId> = [];

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
          removeLater: (_owner, ids) => {
            removed.push(...ids);

            return Effect.void;
          },
        },
      }
    );
  }
);

it.effect('pages thirty later articles and continues from the cursor', () => {
  const items = series(31);
  const calls: Array<ArticleQuery> = [];
  const owners: Array<OwnerId> = [];

  return provide(
    Effect.gen(function* () {
      const first = yield* listLaterArticles(alice, 'all');
      expect(first.items.map((item) => item.id)).toEqual(
        items.slice(0, 30).map((item) => item.id)
      );
      expect(first.cursor).not.toBeNull();
      expect(first.boundary).toBe(first.cursor);
      expect(calls[0]).toEqual({ filter: 'all', limit: 31 });
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
        filter: 'all',
        limit: 31,
        after: {
          id: items[29]?.id,
          publishedAt: encodedTime(items[29] as Article),
        },
      });
      expect(owners).toEqual([alice, alice]);
    }),
    {
      articles: {
        listLater: (owner, query) => {
          calls.push(query);
          owners.push(owner);

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
    { articles: pagedArticles(items) }
  );
});

it.effect('lists a scoped feed or every subscription feed', () => {
  const calls: Array<
    readonly [OwnerId, Option.Option<ReadonlyArray<FeedId>>, ArticleQuery]
  > = [];
  const checks: Array<readonly [OwnerId, FeedId]> = [];

  return provide(
    Effect.gen(function* () {
      yield* listFeedArticles(alice, feed, 'unread');
      yield* listFeedArticles(alice, undefined, 'read');
      expect(
        calls.map(([owner, feedIds, query]) => [owner, feedIds, query.filter])
      ).toEqual([
        [alice, Option.some([feed]), 'unread'],
        [alice, Option.none(), 'read'],
      ]);
      expect(checks).toEqual([[alice, feed]]);
    }),
    {
      articles: {
        listFeeds: (owner, feedIds, query) => {
          calls.push([owner, feedIds, query]);

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
  const calls: Array<ArticleQuery> = [];

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
          filter: 'all',
          limit: 31,
          through: {
            id: items[59]?.id,
            publishedAt: encodedTime(items[59] as Article),
          },
        },
        {
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
        listLater: (owner, query) => {
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
    { articles: pagedArticles(items) }
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
    { articles: { listLater: () => Effect.succeed([]) } }
  )
);

it.effect('refreshes from a boundary whose article was removed', () => {
  const items = series(40);
  const calls: Array<ArticleQuery> = [];
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
        listLater: (owner, query) => {
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
      articles: pagedArticles(items),
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
