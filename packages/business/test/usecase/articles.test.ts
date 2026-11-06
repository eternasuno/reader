// biome-ignore-all lint/style/noExcessiveLinesPerFile: usecase tests share one set of article fixtures and layers.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: each test declares its dependency mocks alongside the scenario.
import { expect, it } from '@effect/vitest';
import {
  type Context,
  type DateTime,
  Effect,
  Layer,
  Option,
  Schema,
} from 'effect';
import {
  Article,
  ArticleContent,
  ArticleDescription,
  ArticleId,
  ArticleTitle,
} from '../../src/entity/article';
import { Feed } from '../../src/entity/feed';
import {
  FeedId,
  NormalizedUrl,
  OptionFromOptionalNonEmpty,
  OwnerId,
} from '../../src/entity/object-value';
import { ArticleExtractor } from '../../src/port/article-extractor';
import {
  type ArticleCursor,
  ArticleCursorFromString,
} from '../../src/port/article-pagination';
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
} from '../../src/port/webpage-fetcher';
import {
  addArticle,
  extractArticle,
  listFeedArticles,
  listLaterArticles,
  refreshFeedArticles,
  refreshLaterArticles,
  removeArticle,
  saveArticle,
} from '../../src/usecase/articles';
import { articleId } from '../../src/usecase/identity';

const decodeContent = Schema.decodeSync(
  OptionFromOptionalNonEmpty(ArticleContent)
);

const decodeDescription = Schema.decodeSync(
  OptionFromOptionalNonEmpty(ArticleDescription)
);

const decodeTitle = Schema.decodeSync(ArticleTitle);

const decodeUrl = Schema.decodeSync(NormalizedUrl);

const alice = OwnerId.make('alice');

const bob = OwnerId.make('bob');

const feed = FeedId.make('f'.repeat(64));

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
    title: decodeTitle('Title'),
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    read: false,
    ...overrides,
  });

const timeOf = (publishedAt: DateTime.Utc): string =>
  Schema.encodeSync(Schema.DateTimeUtcFromString)(publishedAt);

const encodedTime = (article: Article): string => timeOf(article.publishedAt);

const decodeCursor = (wire: string): ArticleCursor =>
  Schema.decodeSync(ArticleCursorFromString)(wire);

const hex = (value: number): string => value.toString(16).padStart(64, '0');

const series = (count: number): Array<Article> =>
  Array.from({ length: count }, (_, index) =>
    makeArticle({
      id: hex(index),
      title: decodeTitle(`Article ${index}`),
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
      const boundaryAt = timeOf(boundary.publishedAt);

      return (
        publishedAt > boundaryAt ||
        (publishedAt === boundaryAt && item.id > boundary.id)
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

const storedFeed = (id: FeedId): Feed =>
  Schema.decodeUnknownSync(Feed)({
    id,
    ownerId: alice,
    url: 'https://example.com/feed.xml',
    title: decodeTitle('Feed'),
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
    readonly feeds?: Partial<Context.Service.Shape<typeof FeedRepository>>;
  },
  _owner: OwnerId = alice
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ArticleRepository, layers.articles ?? {}),
        Layer.mock(WebpageFetcher, layers.fetcher ?? {}),
        Layer.mock(HtmlParser, {
          parse: () => Effect.succeed(parsedDocument()),
          ...layers.parser,
        }),
        Layer.mock(ArticleExtractor, layers.extractor ?? {}),
        Layer.mock(FeedRepository, layers.feeds ?? {})
      )
    )
  );

it.effect('adds an anonymous Jina article with its URL and body', () => {
  const document = parsedDocument('<p>Body</p>');
  let saved: Article | undefined;

  return provide(
    Effect.gen(function* () {
      const result = yield* addArticle(
        alice,
        decodeUrl('https://example.com/post')
      );
      expect(result.title).toBe('Untitled');
      expect(result.url).toEqual(
        Option.some(new URL('https://example.com/post'))
      );
      expect(result.description).toEqual(Option.none());
      expect(result.content).toEqual(Option.some('<p>Body</p>'));
      expect(result.extractedContent).toEqual(Option.some('<p>Body</p>'));
      expect(result.ownerId).toBe(alice);
      expect(result.feedId).toEqual(Option.none());
      expect(result.read).toBe(false);
      expect(encodedTime(result)).toBe('2024-05-06T07:08:09.000Z');
      expect(saved).toEqual(result);
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
            title: decodeTitle('Untitled'),
            description: decodeDescription(undefined),
            content: decodeContent('<p>Body</p>'),
            publishedAt: extractedPublishedAt,
          });
        },
      },
    }
  );
});

it.effect('keeps extracted description and published date when adding', () => {
  const url = decodeUrl('https://example.com/post');
  let saved: Article | undefined;

  return provide(
    Effect.gen(function* () {
      const result = yield* addArticle(alice, url);
      expect(result.title).toBe('Post');
      expect(result.description).toEqual(decodeDescription('Summary'));
      expect(encodedTime(result)).toBe('2024-05-06T07:08:09.000Z');
      expect(result.id).toBe(
        articleId({
          ownerId: alice,
          feedId: Option.none(),
          url: Option.some(url),
          title: decodeTitle('Post'),
          description: decodeDescription('Summary'),
        })
      );
      expect(saved).toEqual(result);
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
            title: decodeTitle('Post'),
            content: decodeContent('<p>Body</p>'),
            description: decodeDescription('Summary'),
            publishedAt: extractedPublishedAt,
          }),
      },
    }
  );
});

it.effect(
  'derives distinct identities for one url when metadata differs',
  () => {
    const url = decodeUrl('https://example.com/post');
    const ids: Array<ArticleId> = [];
    let attempt = 0;

    return provide(
      Effect.gen(function* () {
        yield* addArticle(alice, url);
        yield* addArticle(alice, url);
        expect(ids).toEqual([
          articleId({
            ownerId: alice,
            feedId: Option.none(),
            url: Option.some(url),
            title: decodeTitle('Post'),
            description: decodeDescription('Summary 1'),
          }),
          articleId({
            ownerId: alice,
            feedId: Option.none(),
            url: Option.some(url),
            title: decodeTitle('Post'),
            description: decodeDescription('Summary 2'),
          }),
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
              title: decodeTitle('Post'),
              content: decodeContent('<p>Body</p>'),
              description: decodeDescription(`Summary ${attempt}`),
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
        addArticle(alice, decodeUrl('https://example.com/post'))
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
            title: decodeTitle('Post'),
            content: decodeContent('<p>Body</p>'),
            description: decodeDescription(undefined),
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
        addArticle(alice, decodeUrl('https://example.com/post'))
      );
      expect(error._tag).toBe('ArticleEmptyContent');
    }),
    {
      articles: { create: () => Effect.die('must not save an empty article') },
      fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
      extractor: {
        extract: () =>
          Effect.succeed({
            title: decodeTitle('Post'),
            description: decodeDescription(undefined),
            content: decodeContent('   '),
            publishedAt: extractedPublishedAt,
          }),
      },
    }
  )
);

it.effect('preserves fetch failure messages while adding', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        addArticle(alice, decodeUrl('https://example.com/post'))
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

it.effect('propagates parser failures while adding', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        addArticle(alice, decodeUrl('https://example.com/post'))
      );
      expect(error._tag).toBe('HtmlParserError');
      expect(error._tag === 'HtmlParserError' && error.message).toBe(
        'malformed markup'
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
      expect(result.id).not.toBe(source.id);
      expect(result.feedId).toEqual(Option.none());
      expect(result.url).toEqual(Option.some(new URL('https://example.com/a')));
      expect(result.title).toBe(source.title);
      expect(result.description).toEqual(decodeDescription('Summary'));
      expect(result.content).toEqual(Option.some('<p>Feed</p>'));
      expect(result.publishedAt).toEqual(source.publishedAt);
      expect(result.read).toBe(false);
      expect(source.read).toBe(true);
      expect(created).toEqual(result);
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
      expect(result.extractedContent).toEqual(Option.some('<p>Extracted</p>'));
      expect(result.read).toBe(false);
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
        expect(yield* extractArticle(alice, article.id)).toBe(article);
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
  let stored = article;
  const saved: Array<
    readonly [OwnerId, ReadonlyArray<ArticleId>, ArticlePatch]
  > = [];

  return provide(
    Effect.gen(function* () {
      expect(yield* extractArticle(alice, article.id)).toEqual(stored);
      expect(stored.extractedContent).toEqual(decodeContent('<p>Fresh</p>'));
      expect(saved).toEqual([
        [
          alice,
          [article.id],
          { extractedContent: decodeContent('<p>Fresh</p>') },
        ],
      ]);
    }),
    {
      articles: {
        find: () => Effect.succeed(Option.some(stored)),
        updateByArticleIds: (owner, ids, articlePatch) => {
          saved.push([owner, ids, articlePatch]);
          stored = { ...stored, ...articlePatch };

          return Effect.succeed(ids);
        },
      },
      fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
      extractor: {
        extract: () =>
          Effect.succeed({
            title: decodeTitle('Fresh'),
            description: decodeDescription(undefined),
            content: decodeContent('<p>Fresh</p>'),
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
            title: decodeTitle('Fresh'),
            description: decodeDescription(undefined),
            content: decodeContent('<p>Fresh</p>'),
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

it.effect(
  'removes only later articles and treats unknown ids as success',
  () => {
    const removed: Array<ArticleId> = [];

    return provide(
      Effect.gen(function* () {
        yield* removeArticle(alice, firstId);
        yield* removeArticle(alice, secondId);
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
        decodeCursor(first.cursor ?? '')
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
          publishedAt: items[29]?.publishedAt,
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
      const cursor = decodeCursor(page.cursor ?? '');
      const decoded = yield* listLaterArticles(alice, 'all', cursor);
      expect(decoded.items).toEqual([items[30]]);

      for (const attempt of [
        listLaterArticles(bob, 'all', cursor),
        listLaterArticles(alice, 'unread', cursor),
        listFeedArticles(alice, undefined, 'all', cursor),
      ]) {
        expect((yield* Effect.flip(attempt))._tag).toBe('InvalidCursor');
      }
    }),
    { articles: pagedArticles(items) }
  );
});

it.effect('lists a scoped feed or every feed', () => {
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
      feeds: {
        find: (owner, id) => {
          checks.push([owner, id]);

          return Effect.succeed(Option.some(storedFeed(id)));
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
        decodeCursor(first.cursor ?? '')
      );
      const boundary = decodeCursor(second.boundary ?? '');
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
            publishedAt: items[59]?.publishedAt,
          },
        },
        {
          filter: 'all',
          limit: 31,
          through: {
            id: items[59]?.id,
            publishedAt: items[59]?.publishedAt,
          },
          after: {
            id: items[30]?.id,
            publishedAt: items[30]?.publishedAt,
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
        decodeCursor(page.boundary ?? '')
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
        decodeCursor(first.cursor ?? '')
      );
      expect(second.cursor).toBeNull();
      stored = items.filter((item) => item.id !== items[39]?.id);
      const refreshed = yield* refreshLaterArticles(
        alice,
        'all',
        decodeCursor(second.boundary ?? '')
      );
      expect(refreshed.map((item) => item.id)).toEqual(
        items.slice(0, 39).map((item) => item.id)
      );
      expect(calls.at(-1)?.through).toEqual({
        id: items[39]?.id,
        publishedAt: items[39]?.publishedAt,
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
      expect(listError._tag).toBe('FeedNotFound');
      expect(listError._tag === 'FeedNotFound' && listError.id).toBe(feed);
      const refreshError = yield* Effect.flip(
        refreshFeedArticles(
          alice,
          feed,
          'all',
          decodeCursor(page.boundary ?? '')
        )
      );
      expect(refreshError._tag).toBe('FeedNotFound');
    }),
    {
      articles: pagedArticles(items),
      feeds: {
        find: (owner, id) => {
          expect([owner, id]).toEqual([alice, feed]);

          return Effect.succeed(
            exists ? Option.some(storedFeed(id)) : Option.none()
          );
        },
      },
    }
  );
});
