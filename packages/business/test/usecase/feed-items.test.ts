// biome-ignore-all lint/style/noExcessiveLinesPerFile: feed item tests share one set of fixtures and layers.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: each test declares its dependency mocks alongside the scenario.
import { expect, it } from '@effect/vitest';
import { type Context, Effect, Layer, Option } from 'effect';
import { FeedId } from '../../src/entity/feed/feed';
import { FeedItemId } from '../../src/entity/feed/feed-item';
import { ArticleExtractor } from '../../src/port/article-extractor';
import {
  type FeedItemQuery,
  FeedItemRepository,
} from '../../src/port/feed-item-repository';
import { FeedRepository } from '../../src/port/feed-repository';
import { HtmlParser } from '../../src/port/html-parser';
import {
  WebpageFetcher,
  WebpageFetcherError,
} from '../../src/port/webpage-fetcher';
import {
  extractFeedItem,
  findFeedItem,
  listFeedItems,
  markFeedItems,
  markFeedsRead,
  refreshFeedItems,
} from '../../src/usecase/feed-items';
import {
  alice,
  decodeContent,
  decodeCursor,
  decodeDescription,
  decodeTitle,
  extractedPublishedAt,
  feedId,
  hex,
  makeFeedItem,
  otherFeedId,
  pagedStore,
  parsedDocument,
  series,
  storedFeed,
} from '../support';

const provide = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layers: {
    readonly items?: Partial<Context.Service.Shape<typeof FeedItemRepository>>;
    readonly feeds?: Partial<Context.Service.Shape<typeof FeedRepository>>;
    readonly fetcher?: Partial<Context.Service.Shape<typeof WebpageFetcher>>;
    readonly extractor?: Partial<
      Context.Service.Shape<typeof ArticleExtractor>
    >;
  } = {}
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(FeedItemRepository, layers.items ?? {}),
        Layer.mock(FeedRepository, {
          find: () => Effect.succeed(Option.some(storedFeed())),
          ...layers.feeds,
        }),
        Layer.mock(WebpageFetcher, layers.fetcher ?? {}),
        Layer.mock(HtmlParser, {
          parse: () => Effect.succeed(parsedDocument()),
        }),
        Layer.mock(ArticleExtractor, layers.extractor ?? {})
      )
    )
  );

const itemId = FeedItemId.make(hex(1));

it.effect('lists a scoped feed after checking it belongs to the owner', () => {
  const requested: Array<ReadonlyArray<string>> = [];

  return provide(
    Effect.gen(function* () {
      const page = yield* listFeedItems(alice, feedId, 'unread');
      expect(requested).toEqual([[feedId]]);
      expect(page).toEqual({ items: [], cursor: null, boundary: null });
    }),
    {
      feeds: {
        find: (owner, id) => {
          expect(owner).toBe(alice);
          expect(id).toBe(feedId);

          return Effect.succeed(Option.some(storedFeed()));
        },
      },
      items: {
        list: (feedIds, query: FeedItemQuery) => {
          requested.push(feedIds);
          expect(query).toEqual({ filter: 'unread', limit: 31 });

          return Effect.succeed([]);
        },
      },
    }
  );
});

it.effect('lists every feed of the owner when no feed is given', () => {
  const requested: Array<ReadonlyArray<string>> = [];

  return provide(
    Effect.gen(function* () {
      yield* listFeedItems(alice, undefined, 'all');
      expect(requested).toEqual([[feedId, otherFeedId]]);
    }),
    {
      feeds: {
        list: () =>
          Effect.succeed([storedFeed(feedId), storedFeed(otherFeedId)]),
      },
      items: {
        list: (feedIds) => {
          requested.push(feedIds);

          return Effect.succeed([]);
        },
      },
    }
  );
});

it.effect('rejects feed pages once the feed no longer exists', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(listFeedItems(alice, feedId, 'all'));
      expect(error._tag).toBe('FeedNotFound');
    }),
    { feeds: { find: () => Effect.succeed(Option.none()) } }
  )
);

const listing = (count: number) => {
  const store = pagedStore(series(count, makeFeedItem));

  return {
    items: {
      list: (_ids: ReadonlyArray<string>, query: FeedItemQuery) => store(query),
    },
  };
};

it.effect('pages feed items and binds cursors to their feed scope', () =>
  provide(
    Effect.gen(function* () {
      const first = yield* listFeedItems(alice, feedId, 'all');
      expect(first.items).toHaveLength(30);
      const cursor = decodeCursor(first.cursor ?? '');

      const second = yield* listFeedItems(alice, feedId, 'all', cursor);
      expect(second.items[0]?.id).toBe(hex(30));

      const otherFeed = yield* Effect.flip(
        listFeedItems(alice, otherFeedId, 'all', cursor)
      );
      const allFeeds = yield* Effect.flip(
        listFeedItems(alice, undefined, 'all', cursor)
      );
      expect(otherFeed._tag).toBe('InvalidCursor');
      expect(allFeeds._tag).toBe('InvalidCursor');
    }),
    {
      ...listing(65),
      feeds: {
        find: () => Effect.succeed(Option.some(storedFeed())),
        list: () => Effect.succeed([storedFeed()]),
      },
    }
  )
);

it.effect(
  'refreshes feed items through the original boundary inclusively',
  () =>
    provide(
      Effect.gen(function* () {
        const first = yield* listFeedItems(alice, feedId, 'all');
        const refreshed = yield* refreshFeedItems(
          alice,
          feedId,
          'all',
          decodeCursor(first.boundary ?? '')
        );
        expect(refreshed.map((item) => item.id)).toEqual(
          Array.from({ length: 30 }, (_, index) => hex(index))
        );
      }),
      listing(65)
    )
);

it.effect(
  'returns existing extracted content without external requests',
  () => {
    const item = makeFeedItem({ extractedContent: '<p>Done</p>' });

    return provide(
      Effect.gen(function* () {
        expect(yield* extractFeedItem(alice, feedId, itemId)).toEqual(item);
      }),
      { items: { find: () => Effect.succeed(Option.some(item)) } }
    );
  }
);

it.effect('rejects extraction when the item has no URL', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(extractFeedItem(alice, feedId, itemId));
      expect(error._tag).toBe('FeedItemMissingUrl');
    }),
    {
      items: {
        find: () => Effect.succeed(Option.some(makeFeedItem())),
      },
    }
  )
);

const extracting = {
  fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
  extractor: {
    extract: () =>
      Effect.succeed({
        title: decodeTitle('Post'),
        description: decodeDescription(undefined),
        content: decodeContent('<p>Extracted</p>'),
        publishedAt: extractedPublishedAt,
      }),
  },
};

it.effect('extracts, persists, and returns the item body', () => {
  const item = makeFeedItem({ url: 'https://example.com/post' });
  const patches: Array<unknown> = [];

  return provide(
    Effect.gen(function* () {
      const result = yield* extractFeedItem(alice, feedId, itemId);
      expect(result.extractedContent).toEqual(Option.some('<p>Extracted</p>'));
      expect(patches).toEqual([
        {
          feedId,
          ids: [itemId],
          extractedContent: Option.some('<p>Extracted</p>'),
        },
      ]);
    }),
    {
      ...extracting,
      items: {
        find: () => Effect.succeed(Option.some(item)),
        update: (requestedFeed, ids, patch) => {
          patches.push({ feedId: requestedFeed, ids, ...patch });

          return Effect.succeed(ids);
        },
      },
    }
  );
});

it.effect('treats a deleted item as missing after extraction', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(extractFeedItem(alice, feedId, itemId));
      expect(error._tag).toBe('FeedItemNotFound');
    }),
    {
      ...extracting,
      items: {
        find: () =>
          Effect.succeed(
            Option.some(makeFeedItem({ url: 'https://example.com/post' }))
          ),
        update: () => Effect.succeed([]),
      },
    }
  )
);

it.effect('reports a missing feed or item and preserves fetch failures', () =>
  Effect.gen(function* () {
    const noFeed = yield* Effect.flip(
      provide(extractFeedItem(alice, feedId, itemId), {
        feeds: { find: () => Effect.succeed(Option.none()) },
      })
    );
    expect(noFeed._tag).toBe('FeedNotFound');

    const noItem = yield* Effect.flip(
      provide(extractFeedItem(alice, feedId, itemId), {
        items: { find: () => Effect.succeed(Option.none()) },
      })
    );
    expect(noItem._tag).toBe('FeedItemNotFound');

    const fetchFailure = yield* Effect.flip(
      provide(extractFeedItem(alice, feedId, itemId), {
        items: {
          find: () =>
            Effect.succeed(
              Option.some(makeFeedItem({ url: 'https://example.com/post' }))
            ),
        },
        fetcher: {
          fetch: () =>
            Effect.fail(new WebpageFetcherError({ message: 'fetch failed' })),
        },
      })
    );
    expect(fetchFailure).toMatchObject({ message: 'fetch failed' });
  })
);

it.effect('finds a feed item only inside an owned feed', () =>
  Effect.gen(function* () {
    const item = makeFeedItem();
    const found = yield* provide(findFeedItem(alice, feedId, itemId), {
      items: { find: () => Effect.succeed(Option.some(item)) },
    });
    expect(found).toEqual(Option.some(item));

    const error = yield* Effect.flip(
      provide(findFeedItem(alice, feedId, itemId), {
        feeds: { find: () => Effect.succeed(Option.none()) },
      })
    );
    expect(error._tag).toBe('FeedNotFound');
  })
);

it.effect('marks feed items read after checking feed ownership', () => {
  const updates: Array<unknown> = [];

  return Effect.gen(function* () {
    yield* provide(markFeedItems(alice, feedId, [itemId], false), {
      items: {
        update: (requestedFeed, ids, patch) => {
          updates.push({ requestedFeed, ids, patch });

          return Effect.succeed(ids);
        },
      },
    });
    expect(updates).toEqual([
      { requestedFeed: feedId, ids: [itemId], patch: { read: false } },
    ]);

    const error = yield* Effect.flip(
      provide(markFeedItems(alice, feedId, [itemId], true), {
        feeds: { find: () => Effect.succeed(Option.none()) },
      })
    );
    expect(error._tag).toBe('FeedNotFound');
    expect(updates).toHaveLength(1);
  });
});

it.effect('marks only the requested feeds the owner actually has', () => {
  const marked: Array<ReadonlyArray<string>> = [];

  return provide(
    Effect.gen(function* () {
      yield* markFeedsRead(alice, [feedId, FeedId.make('foreign')]);
      expect(marked).toEqual([[feedId]]);
    }),
    {
      feeds: { list: () => Effect.succeed([storedFeed(feedId)]) },
      items: {
        updateByFeeds: (feedIds, patch) => {
          expect(patch).toEqual({ read: true });
          marked.push(feedIds);

          return Effect.succeed([]);
        },
      },
    }
  );
});
