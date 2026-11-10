// biome-ignore-all lint/style/noExcessiveLinesPerFile: saved page tests share one set of fixtures and layers.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: each test declares its dependency mocks alongside the scenario.
import { expect, it } from '@effect/vitest';
import { type Context, Effect, Layer, Option } from 'effect';
import { FeedItemId } from '../../src/entity/feed/feed-item';
import type { OwnerId } from '../../src/entity/object-value/owner-id';
import type { SavedPage } from '../../src/entity/saved-page/saved-page';
import { SavedPageId } from '../../src/entity/saved-page/saved-page';
import { ArticleExtractor } from '../../src/port/article-extractor';
import { FeedItemRepository } from '../../src/port/feed-item-repository';
import { FeedRepository } from '../../src/port/feed-repository';
import { HtmlParser, HtmlParserError } from '../../src/port/html-parser';
import { SavedPageRepository } from '../../src/port/saved-page-repository';
import {
  WebpageFetcher,
  WebpageFetcherError,
} from '../../src/port/webpage-fetcher';
import { savedPageId } from '../../src/usecase/identity';
import {
  addSavedPage,
  findSavedPage,
  listSavedPages,
  markAllSavedPagesRead,
  markSavedPages,
  removeSavedPage,
  saveFeedItem,
} from '../../src/usecase/saved-pages';
import {
  alice,
  bob,
  decodeContent,
  decodeCursor,
  decodeDescription,
  decodeTitle,
  decodeUrl,
  extractedPublishedAt,
  feedId,
  hex,
  makeFeedItem,
  makeSavedPage,
  pagedStore,
  parsedDocument,
  series,
  storedFeed,
  timeOf,
} from '../support';

const itemId = FeedItemId.make(hex(1));

const provide = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layers: {
    readonly pages?: Partial<Context.Service.Shape<typeof SavedPageRepository>>;
    readonly items?: Partial<Context.Service.Shape<typeof FeedItemRepository>>;
    readonly fetcher?: Partial<Context.Service.Shape<typeof WebpageFetcher>>;
    readonly parser?: Partial<Context.Service.Shape<typeof HtmlParser>>;
    readonly extractor?: Partial<
      Context.Service.Shape<typeof ArticleExtractor>
    >;
    readonly feeds?: Partial<Context.Service.Shape<typeof FeedRepository>>;
  } = {}
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(SavedPageRepository, layers.pages ?? {}),
        Layer.mock(FeedItemRepository, layers.items ?? {}),
        Layer.mock(WebpageFetcher, layers.fetcher ?? {}),
        Layer.mock(HtmlParser, {
          parse: () => Effect.succeed(parsedDocument()),
          ...layers.parser,
        }),
        Layer.mock(ArticleExtractor, layers.extractor ?? {}),
        Layer.mock(FeedRepository, {
          find: () => Effect.succeed(Option.some(storedFeed())),
          ...layers.feeds,
        })
      )
    )
  );

const extracting = (
  overrides: Partial<{
    title: string;
    description: string | undefined;
    content: string | undefined;
  }> = {}
) => ({
  fetcher: { fetch: () => Effect.succeed('<html>raw</html>') },
  extractor: {
    extract: () =>
      Effect.succeed({
        title: decodeTitle(overrides.title ?? 'Post'),
        description: decodeDescription(overrides.description),
        content: decodeContent(
          'content' in overrides ? overrides.content : '<p>Body</p>'
        ),
        publishedAt: extractedPublishedAt,
      }),
  },
});

const creating = (saved: Array<SavedPage>) => ({
  create: (pages: ReadonlyArray<SavedPage>) => {
    saved.push(...pages);

    return Effect.succeed(pages.map((page) => page.id));
  },
});

it.effect('adds a link with its URL, extracted body, and derived id', () => {
  const url = decodeUrl('https://example.com/post');
  const saved: Array<SavedPage> = [];

  return provide(
    Effect.gen(function* () {
      const page = yield* addSavedPage(alice, url);
      expect(page.url).toEqual(Option.some(url));
      expect(page.title).toBe('Post');
      expect(page.description).toEqual(decodeDescription('Summary'));
      expect(page.content).toBe('<p>Body</p>');
      expect(page.ownerId).toBe(alice);
      expect(page.read).toBe(false);
      expect(timeOf(page.publishedAt)).toBe('2024-05-06T07:08:09.000Z');
      expect(page.id).toBe(
        savedPageId({
          ownerId: alice,
          url: Option.some(url),
          title: decodeTitle('Post'),
          description: decodeDescription('Summary'),
        })
      );
      expect(saved).toEqual([page]);
    }),
    {
      pages: creating(saved),
      ...extracting({ description: 'Summary' }),
      parser: {
        parse: (html, parsedUrl) => {
          expect(html).toBe('<html>raw</html>');
          expect(parsedUrl?.href).toBe('https://example.com/post');

          return Effect.succeed(parsedDocument());
        },
      },
    }
  );
});

it.effect('reports a duplicate link with the derived id', () => {
  const url = decodeUrl('https://example.com/post');

  return provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(addSavedPage(alice, url));
      expect(error._tag).toBe('DuplicateSavedPage');
      expect(error).toMatchObject({
        id: savedPageId({
          ownerId: alice,
          url: Option.some(url),
          title: decodeTitle('Post'),
          description: decodeDescription(undefined),
        }),
      });
    }),
    {
      pages: { create: () => Effect.succeed([]) },
      ...extracting(),
    }
  );
});

it.effect('rejects an empty extracted body without saving', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        addSavedPage(alice, decodeUrl('https://example.com/post'))
      );
      expect(error._tag).toBe('ArticleEmptyContent');
    }),
    { ...extracting({ content: undefined }) }
  )
);

it.effect('preserves fetch and parse failures while adding', () =>
  Effect.gen(function* () {
    const url = decodeUrl('https://example.com/post');
    const fetchError = yield* Effect.flip(
      provide(addSavedPage(alice, url), {
        fetcher: {
          fetch: () =>
            Effect.fail(new WebpageFetcherError({ message: 'fetch failed' })),
        },
      })
    );
    expect(fetchError).toMatchObject({ message: 'fetch failed' });

    const parseError = yield* Effect.flip(
      provide(addSavedPage(alice, url), {
        fetcher: { fetch: () => Effect.succeed('<html/>') },
        parser: {
          parse: () =>
            Effect.fail(new HtmlParserError({ message: 'parse failed' })),
        },
      })
    );
    expect(parseError).toMatchObject({ message: 'parse failed' });
  })
);

it.effect(
  'saves a feed item with its extracted body and no network use',
  () => {
    const saved: Array<SavedPage> = [];
    const item = makeFeedItem({
      id: hex(7),
      url: 'https://example.com/post',
      description: 'Summary',
      content: '<p>Feed body</p>',
      extractedContent: '<p>Extracted</p>',
    });

    return provide(
      Effect.gen(function* () {
        const page = yield* saveFeedItem(alice, feedId, item.id);
        expect(page.content).toBe('<p>Extracted</p>');
        expect(page.url).toEqual(item.url);
        expect(page.title).toBe(item.title);
        expect(page.description).toEqual(item.description);
        expect(page.publishedAt).toEqual(item.publishedAt);
        expect(page.read).toBe(false);
        expect(page.ownerId).toBe(alice);
        expect(page.id).toBe(
          savedPageId({
            ownerId: alice,
            url: item.url,
            title: item.title,
            description: item.description,
          })
        );
        expect(saved).toEqual([page]);
      }),
      {
        pages: creating(saved),
        items: {
          find: (requestedFeed, id) => {
            expect(requestedFeed).toBe(feedId);
            expect(id).toBe(item.id);

            return Effect.succeed(Option.some(item));
          },
        },
      }
    );
  }
);

it.effect('falls back to feed content, then fetches by URL, then fails', () =>
  Effect.gen(function* () {
    const saved: Array<SavedPage> = [];
    const find = (item: ReturnType<typeof makeFeedItem>) => ({
      items: { find: () => Effect.succeed(Option.some(item)) },
    });

    const fromFeed = yield* provide(saveFeedItem(alice, feedId, itemId), {
      pages: creating(saved),
      ...find(makeFeedItem({ content: '<p>Feed body</p>' })),
    });
    expect(fromFeed.content).toBe('<p>Feed body</p>');

    const fetched = yield* provide(saveFeedItem(alice, feedId, itemId), {
      pages: creating(saved),
      ...find(makeFeedItem({ url: 'https://example.com/post' })),
      ...extracting({ content: '<p>Fetched</p>' }),
    });
    expect(fetched.content).toBe('<p>Fetched</p>');

    const empty = yield* Effect.flip(
      provide(saveFeedItem(alice, feedId, itemId), {
        pages: creating(saved),
        ...find(makeFeedItem()),
      })
    );
    expect(empty._tag).toBe('ArticleEmptyContent');
  })
);

it.effect('reports a missing feed or feed item when saving', () =>
  Effect.gen(function* () {
    const noFeed = yield* Effect.flip(
      provide(saveFeedItem(alice, feedId, itemId), {
        feeds: { find: () => Effect.succeed(Option.none()) },
      })
    );
    expect(noFeed._tag).toBe('FeedNotFound');

    const noItem = yield* Effect.flip(
      provide(saveFeedItem(alice, feedId, itemId), {
        items: { find: () => Effect.succeed(Option.none()) },
      })
    );
    expect(noItem._tag).toBe('FeedItemNotFound');
  })
);

it.effect('reports a duplicate saved copy with its id', () => {
  const item = makeFeedItem({ content: '<p>Body</p>' });

  return provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(saveFeedItem(alice, feedId, item.id));
      expect(error._tag).toBe('DuplicateSavedPage');
    }),
    {
      pages: { create: () => Effect.succeed([]) },
      items: { find: () => Effect.succeed(Option.some(item)) },
    }
  );
});

it.effect('removes a saved page and treats unknown ids as success', () => {
  const removed: Array<{ owner: OwnerId; ids: ReadonlyArray<string> }> = [];

  return provide(
    Effect.gen(function* () {
      yield* removeSavedPage(alice, SavedPageId.make(hex(3)));
      expect(removed).toEqual([{ owner: alice, ids: [hex(3)] }]);
    }),
    {
      pages: {
        remove: (owner, ids) => {
          removed.push({ owner, ids });

          return Effect.void;
        },
      },
    }
  );
});

const listing = (count: number) => {
  const store = pagedStore(series(count, makeSavedPage));

  return {
    pages: {
      list: (_owner: OwnerId, query: Parameters<typeof store.list>[0]) =>
        store.list(query),
    },
  };
};

it.effect('pages thirty saved pages and continues from the cursor', () =>
  provide(
    Effect.gen(function* () {
      const first = yield* listSavedPages(alice, 'all');
      expect(first.items).toHaveLength(30);
      expect(first.items[0]?.id).toBe(hex(0));
      expect(first.cursor).not.toBeNull();

      const second = yield* listSavedPages(
        alice,
        'all',
        decodeCursor(first.cursor ?? '')
      );
      expect(second.items[0]?.id).toBe(hex(30));

      const third = yield* listSavedPages(
        alice,
        'all',
        decodeCursor(second.cursor ?? '')
      );
      expect(third.items).toHaveLength(5);
      expect(third.cursor).toBeNull();
    }),
    listing(65)
  )
);

it.effect('returns an empty page without a cursor', () =>
  provide(
    Effect.gen(function* () {
      const page = yield* listSavedPages(alice, 'all');
      expect(page).toEqual({ items: [], cursor: null });
    }),
    listing(0)
  )
);

it.effect('binds cursors to owner, scope, and filter', () =>
  provide(
    Effect.gen(function* () {
      const first = yield* listSavedPages(alice, 'all');
      const cursor = decodeCursor(first.cursor ?? '');
      const wrongOwner = yield* Effect.flip(listSavedPages(bob, 'all', cursor));
      const wrongFilter = yield* Effect.flip(
        listSavedPages(alice, 'unread', cursor)
      );
      expect(wrongOwner._tag).toBe('InvalidCursor');
      expect(wrongFilter._tag).toBe('InvalidCursor');
    }),
    listing(65)
  )
);

it.effect('finds and marks saved pages within the owner scope', () => {
  const calls: Array<unknown> = [];
  const page = makeSavedPage();

  return provide(
    Effect.gen(function* () {
      expect(yield* findSavedPage(alice, SavedPageId.make(hex(1)))).toEqual(
        Option.some(page)
      );
      yield* markSavedPages(alice, [SavedPageId.make(hex(1))], true);
      yield* markAllSavedPagesRead(alice);
      expect(calls).toEqual([
        { owner: alice, ids: [hex(1)], patch: { read: true } },
        { owner: alice, patch: { read: true } },
      ]);
    }),
    {
      pages: {
        find: (owner) => {
          expect(owner).toBe(alice);

          return Effect.succeed(Option.some(page));
        },
        update: (owner, ids, patch) => {
          calls.push({ owner, ids, patch });

          return Effect.succeed(ids);
        },
        updateAll: (owner, patch) => {
          calls.push({ owner, patch });

          return Effect.succeed([]);
        },
      },
    }
  );
});
