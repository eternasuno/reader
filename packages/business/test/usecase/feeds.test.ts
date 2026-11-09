// biome-ignore-all lint/style/noExcessiveLinesPerFile: feed workflow tests share one set of feed and store fixtures.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: each test declares its mocks alongside the asserted scenario.
import { expect, it } from '@effect/vitest';
import { type Context, DateTime, Effect, Layer, Option, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import type { Feed } from '../../src/entity/feed/feed';
import { type FeedItem, FeedItemId } from '../../src/entity/feed/feed-item';
import {
  ArticleContent,
  ArticleDescription,
  ArticleTitle,
} from '../../src/entity/object-value/article';
import { NormalizedUrl } from '../../src/entity/object-value/normalized-url';
import { OptionFromOptionalNonEmpty } from '../../src/entity/object-value/option-from-optional-non-empty';
import { OwnerId } from '../../src/entity/object-value/owner-id';
import { Retention } from '../../src/entity/setting/feed';
import type { Setting } from '../../src/entity/setting/setting';
import { DocumentSanitizer } from '../../src/port/document-sanitizer';
import { FeedFetcher, FetchFeedError } from '../../src/port/feed-fetcher';
import {
  type FeedItemBoundary,
  FeedItemRepository,
  FeedItemRepositoryError,
} from '../../src/port/feed-item-repository';
import {
  FeedParser,
  FeedParserError,
  type ParsedFeed,
  type ParsedFeedItem,
} from '../../src/port/feed-parser';
import {
  FeedRepository,
  type FeedUpdate,
} from '../../src/port/feed-repository';
import { HtmlParser } from '../../src/port/html-parser';
import { SettingsRepository } from '../../src/port/settings-repository';
import { addFeed, refreshFeed } from '../../src/usecase/feeds';
import { feedId, feedItemId } from '../../src/usecase/identity';

const decodeContent = Schema.decodeSync(
  OptionFromOptionalNonEmpty(ArticleContent)
);

const decodeDescription = Schema.decodeSync(
  OptionFromOptionalNonEmpty(ArticleDescription)
);

const decodeTitle = Schema.decodeSync(ArticleTitle);

const decodeUrl = Schema.decodeSync(NormalizedUrl);

const decodeRetention = Schema.decodeSync(Retention);

const alice = OwnerId.make('alice');

const url = decodeUrl('https://example.com/feed.xml');

const id = feedId(alice, url);

const nowMillis = Date.UTC(2026, 0, 1, 12);

const at = (iso: string) => DateTime.fromDateUnsafe(new Date(iso));

// The processing services are mocked here, so the parser only needs the body
// that the processor mock reads back.
const parsedDocument = (html: string) =>
  ({ URL: 'about:blank', body: { innerHTML: html } }) as Document;

const encoded = (value: DateTime.Utc) =>
  Schema.encodeSync(Schema.DateTimeUtcFromString)(value);

const entry = (overrides: Partial<ParsedFeedItem> = {}): ParsedFeedItem => ({
  title: decodeTitle('One'),
  url: Option.some(decodeUrl('https://example.com/one')),
  description: decodeDescription(undefined),
  content: decodeContent(undefined),
  publishedAt: at('2026-01-01T12:00:00.000Z'),
  ...overrides,
});

const feed = (
  items: ReadonlyArray<ParsedFeedItem>,
  title = 'News'
): ParsedFeed => ({ title, url, description: Option.none(), items });

const storedFeed = (): Feed => ({
  id,
  ownerId: alice,
  url,
  title: decodeTitle('Old'),
  updatedAt: at('2025-12-01T00:00:00.000Z'),
});

const feedBody = '<rss/>';

const feedDocument = (url: URL) => ({ content: feedBody, url });

const settingsValue = (retention: Setting['feed']['retention']): Setting => ({
  ownerId: alice,
  feed: { retention },
  fetcher: {
    provider: 'jina',
    jina: { key: Option.none() },
    browser: { endpoint: Option.none() },
  },
});

const provide = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layers: {
    readonly feedFetcher?: Partial<Context.Service.Shape<typeof FeedFetcher>>;
    readonly feedParser?: Partial<Context.Service.Shape<typeof FeedParser>>;
    readonly parser?: Partial<Context.Service.Shape<typeof HtmlParser>>;
    readonly processor?: Partial<
      Context.Service.Shape<typeof DocumentSanitizer>
    >;
    readonly items?: Partial<Context.Service.Shape<typeof FeedItemRepository>>;
    readonly feeds?: Partial<Context.Service.Shape<typeof FeedRepository>>;
    readonly settings?: Partial<
      Context.Service.Shape<typeof SettingsRepository>
    >;
  }
) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(FeedFetcher, {
          fetch: (requested) => Effect.succeed(feedDocument(requested)),
          ...layers.feedFetcher,
        }),
        Layer.mock(FeedParser, {
          parse: () => Effect.succeed(feed([])),
          ...layers.feedParser,
        }),
        Layer.mock(HtmlParser, {
          parse: (html) => Effect.succeed(parsedDocument(html)),
          ...layers.parser,
        }),
        Layer.mock(DocumentSanitizer, {
          sanitize: (document) =>
            Effect.succeed(decodeContent(document.body.innerHTML)),
          ...layers.processor,
        }),
        Layer.mock(FeedItemRepository, layers.items ?? {}),
        Layer.mock(FeedRepository, layers.feeds ?? {}),
        Layer.mock(SettingsRepository, {
          get: () => Effect.succeed(settingsValue(decodeRetention(100))),
          ...layers.settings,
        })
      )
    )
  );

it.effect('parses the fetched document against its final URL', () => {
  const finalUrl = new URL('https://final.example/feed.xml');
  const calls: Array<string> = [];

  return provide(
    Effect.gen(function* () {
      yield* refreshFeed(alice, id);
      expect(calls).toEqual([
        `fetch ${url.href}`,
        `parse <rss/> ${finalUrl.href}`,
      ]);
    }),
    {
      settings: {
        get: () => Effect.succeed(settingsValue(decodeRetention(100))),
      },
      feeds: {
        find: () => Effect.succeed(Option.some(storedFeed())),
        update: () => Effect.void,
      },
      feedFetcher: {
        fetch: (requested) => {
          calls.push(`fetch ${requested.href}`);

          return Effect.succeed({ content: feedBody, url: finalUrl });
        },
      },
      feedParser: {
        parse: (content, sourceUrl) => {
          calls.push(`parse ${content} ${sourceUrl.href}`);

          return Effect.succeed(feed([]));
        },
      },
      items: {
        inventory: () => Effect.succeed([]),
        retain: () => Effect.void,
      },
    }
  );
});

it.effect('reports a feed fetch failure without parsing the document', () => {
  let parsed = false;

  return provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(refreshFeed(alice, id));
      expect(error).toMatchObject({
        _tag: 'FetchFeedError',
        message: 'Failed to fetch the feed',
      });
      expect(parsed).toBe(false);
    }),
    {
      feeds: {
        find: () => Effect.succeed(Option.some(storedFeed())),
      },
      feedFetcher: {
        fetch: () =>
          Effect.fail(
            new FetchFeedError({ message: 'Failed to fetch the feed' })
          ),
      },
      feedParser: {
        parse: () => {
          parsed = true;

          return Effect.succeed(feed([]));
        },
      },
    }
  );
});

it.effect('reports a feed parse failure', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(refreshFeed(alice, id));
      expect(error).toMatchObject({
        _tag: 'FeedParserError',
        message: 'Failed to parse the feed feed',
      });
    }),
    {
      feeds: {
        find: () => Effect.succeed(Option.some(storedFeed())),
      },
      feedParser: {
        parse: () =>
          Effect.fail(
            new FeedParserError({
              message: 'Failed to parse the feed feed',
            })
          ),
      },
    }
  )
);

it.effect(
  'creates the feed before importing the newest distinct articles',
  () => {
    const events: Array<string> = [];
    const created: Array<ReadonlyArray<FeedItem>> = [];
    const processed: Array<string> = [];
    const newest = entry({
      title: decodeTitle('Newest'),
      url: Option.some(decodeUrl('https://example.com/newest')),
      description: decodeDescription('Plain summary'),
      content: decodeContent('<p>Body</p>'),
      publishedAt: at('2026-01-02T00:00:00.000Z'),
    });
    const older = entry({
      title: decodeTitle('Older'),
      url: Option.some(decodeUrl('https://example.com/older')),
      content: decodeContent('plain body'),
      publishedAt: at('2026-01-01T00:00:00.000Z'),
    });
    const undated = entry({
      title: decodeTitle('Undated'),
      url: Option.some(decodeUrl('https://example.com/undated')),
    });
    let stored: Feed | undefined;

    return provide(
      Effect.gen(function* () {
        yield* TestClock.setTime(nowMillis);
        const result = yield* addFeed(alice, url);
        expect(result).toEqual(stored);
        expect(stored).toMatchObject({
          id,
          ownerId: alice,
          url,
          title: decodeTitle('News'),
        });
        expect(
          encoded(stored?.updatedAt ?? at('1970-01-01T00:00:00.000Z'))
        ).toBe('2026-01-01T12:00:00.000Z');
        expect(events).toEqual(['feed', 'articles']);
        expect(processed).toEqual([
          'Plain summary',
          '<p>Body</p>',
          'plain body',
        ]);
        const items = created[0] ?? [];
        expect(items.map((item) => item.title)).toEqual([
          'Newest',
          'Undated',
          'Older',
        ]);
        expect(items[0]).toMatchObject({
          description: decodeDescription('Plain summary'),
          content: decodeContent('<p>Body</p>'),
          feedId: id,
          read: false,
        });
        expect(items[0]?.id).toBe(
          feedItemId({
            feedId: id,
            url: newest.url,
            title: newest.title,
            description: newest.description,
          })
        );
        expect(
          encoded(items[0]?.publishedAt ?? at('1970-01-01T00:00:00.000Z'))
        ).toBe('2026-01-02T00:00:00.000Z');
        expect(items[2]).toMatchObject({
          content: decodeContent('plain body'),
        });
        expect(
          encoded(items[1]?.publishedAt ?? at('1970-01-01T00:00:00.000Z'))
        ).toBe('2026-01-01T12:00:00.000Z');
      }),
      {
        feedParser: {
          parse: () =>
            Effect.succeed(feed([older, undated, newest, { ...newest }])),
        },
        feeds: {
          find: () => Effect.succeed(Option.none()),
          create: (owner, items) => {
            events.push('feed');
            expect(owner).toBe(alice);
            stored = items[0];

            return Effect.succeed(items.map((item) => item.id));
          },
        },
        parser: {
          parse: (html) => {
            processed.push(html);

            return Effect.succeed(parsedDocument(html));
          },
        },
        items: {
          create: (items) => {
            events.push('articles');
            created.push(items);

            return Effect.succeed(items.map((item) => item.id));
          },
        },
      }
    );
  }
);

it.effect('imports entries without a URL', () => {
  const created: Array<ReadonlyArray<FeedItem>> = [];
  const linkless = entry({
    title: decodeTitle('No URL'),
    url: Option.none(),
    content: decodeContent('plain body'),
  });

  return provide(
    Effect.gen(function* () {
      yield* addFeed(alice, url);
      const items = created[0] ?? [];
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        title: decodeTitle('No URL'),
        content: decodeContent('plain body'),
        feedId: id,
      });
      expect(items[0]?.url).toEqual(Option.none());
      expect(items[0]?.id).toBe(
        feedItemId({
          feedId: id,
          url: Option.none(),
          title: decodeTitle('No URL'),
          description: decodeDescription(undefined),
        })
      );
    }),
    {
      feedParser: { parse: () => Effect.succeed(feed([linkless])) },
      feeds: {
        find: () => Effect.succeed(Option.none()),
        create: () => Effect.succeed([id]),
      },
      items: {
        create: (items) => {
          created.push(items);

          return Effect.succeed(items.map((item) => item.id));
        },
      },
    }
  );
});

it.effect('truncates feed content before parsing it', () => {
  const parsed: Array<string> = [];
  const long = entry({ content: decodeContent('a'.repeat(100_500)) });

  return provide(
    Effect.gen(function* () {
      yield* addFeed(alice, url);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toHaveLength(100_000);
    }),
    {
      feedParser: { parse: () => Effect.succeed(feed([long])) },
      feeds: {
        find: () => Effect.succeed(Option.none()),
        create: () => Effect.succeed([id]),
      },
      parser: {
        parse: (html) => {
          parsed.push(html);

          return Effect.succeed(parsedDocument(html));
        },
      },
      items: {
        create: (items) => Effect.succeed(items.map((item) => item.id)),
      },
    }
  );
});

it.effect('imports at most 30 articles from a large feed', () => {
  const created: Array<ReadonlyArray<FeedItem>> = [];
  const entries = Array.from({ length: 35 }, (_, index) =>
    entry({
      title: decodeTitle(`Article ${index}`),
      url: Option.some(decodeUrl(`https://example.com/${index}`)),
      publishedAt: at(new Date(nowMillis + index * 60_000).toISOString()),
    })
  );

  return provide(
    Effect.gen(function* () {
      yield* addFeed(alice, url);
      const items = created[0] ?? [];
      expect(items).toHaveLength(30);
      expect(items[0]?.title).toBe('Article 34');
      expect(items[29]?.title).toBe('Article 5');
    }),
    {
      feedParser: { parse: () => Effect.succeed(feed(entries)) },
      feeds: {
        find: () => Effect.succeed(Option.none()),
        create: () => Effect.succeed([id]),
      },
      items: {
        create: (items) => {
          created.push(items);

          return Effect.succeed(items.map((item) => item.id));
        },
      },
    }
  );
});

it.effect('reports a duplicate feed without fetching the feed', () => {
  let fetched = false;

  return provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(addFeed(alice, url));
      expect(error._tag).toBe('FeedExists');
      expect(error).toMatchObject({
        id,
        message: 'Feed already exists',
      });
      expect(fetched).toBe(false);
    }),
    {
      feeds: {
        find: () => Effect.succeed(Option.some(storedFeed())),
      },
      feedFetcher: {
        fetch: (requested) => {
          fetched = true;

          return Effect.succeed(feedDocument(requested));
        },
      },
    }
  );
});

it.effect('reports a duplicate feed when creation loses a race', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(addFeed(alice, url));
      expect(error._tag).toBe('FeedExists');
      expect(error).toMatchObject({ id });
    }),
    {
      feeds: {
        find: () => Effect.succeed(Option.none()),
        create: () => Effect.succeed([]),
      },
      feedParser: { parse: () => Effect.succeed(feed([])) },
    }
  )
);

it.effect('propagates an article write failure while adding a feed', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(addFeed(alice, url));
      expect(error._tag).toBe('FeedItemRepositoryError');
      expect(error).toMatchObject({ message: 'write failed' });
    }),
    {
      feeds: {
        find: () => Effect.succeed(Option.none()),
        create: () => Effect.succeed([id]),
      },
      feedParser: { parse: () => Effect.succeed(feed([entry()])) },
      items: {
        create: () =>
          Effect.fail(new FeedItemRepositoryError({ message: 'write failed' })),
      },
    }
  )
);

it.effect('does not fetch a missing feed', () => {
  let fetched = false;

  return provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(refreshFeed(alice, id));
      expect(error._tag).toBe('FeedNotFound');
      expect(error).toMatchObject({
        id,
        message: 'Feed not found',
      });
      expect(fetched).toBe(false);
    }),
    {
      feeds: { find: () => Effect.succeed(Option.none()) },
      feedFetcher: {
        fetch: (requested) => {
          fetched = true;

          return Effect.succeed(feedDocument(requested));
        },
      },
    }
  );
});

it.effect(
  'keeps existing articles first on ties and imports only retained new ones',
  () => {
    const events: Array<string> = [];
    const created: Array<ReadonlyArray<FeedItem>> = [];
    const retained: Array<ReadonlyArray<FeedItemId>> = [];
    const processed: Array<string> = [];
    const knownUrl = decodeUrl('https://example.com/known');
    const knownId = feedItemId({
      feedId: id,
      url: Option.some(knownUrl),
      title: decodeTitle('Known'),
      description: decodeDescription(undefined),
    });
    const tied = entry({
      title: decodeTitle('Tied'),
      url: Option.some(decodeUrl('https://example.com/tied')),
      content: decodeContent('<p>Tied body</p>'),
      publishedAt: at('2026-01-02T00:00:00.000Z'),
    });
    const known = entry({
      title: decodeTitle('Known'),
      url: Option.some(knownUrl),
    });
    const inventory: Array<FeedItemBoundary> = [
      {
        id: FeedItemId.make('b'.repeat(64)),
        publishedAt: at('2026-01-02T00:00:00.000Z'),
      },
      { id: knownId, publishedAt: at('2026-01-01T00:00:00.000Z') },
    ];
    const patches: Array<FeedUpdate> = [];
    let patchedOwner: string | undefined;
    let current = storedFeed();

    return provide(
      Effect.gen(function* () {
        yield* TestClock.setTime(nowMillis);
        const result = yield* refreshFeed(alice, id);
        expect(events).toEqual(['articles', 'retain', 'update']);
        expect(created[0]?.map((item) => item.title)).toEqual(['Tied']);
        expect(retained[0]).toEqual([
          FeedItemId.make('b'.repeat(64)),
          feedItemId({
            feedId: id,
            url: tied.url,
            title: tied.title,
            description: tied.description,
          }),
          knownId,
        ]);
        expect(processed).toEqual(['<p>Tied body</p>']);
        expect(patchedOwner).toBe(alice);
        expect(patches).toEqual([
          {
            id,
            feedPatch: {
              title: decodeTitle('Updated'),
              updatedAt: at('2026-01-01T12:00:00.000Z'),
            },
          },
        ]);
        expect(result).toMatchObject({
          id,
          url,
          title: decodeTitle('Updated'),
        });
        expect(
          encoded(result.updatedAt ?? at('1970-01-01T00:00:00.000Z'))
        ).toBe('2026-01-01T12:00:00.000Z');
      }),
      {
        settings: {
          get: () => Effect.succeed(settingsValue(decodeRetention(100))),
        },
        feeds: {
          find: () => Effect.succeed(Option.some(current)),
          update: (owner, items) =>
            Effect.sync(() => {
              events.push('update');
              patchedOwner = owner;
              patches.push(...items);
              const patch = items[0]?.feedPatch;
              current = {
                ...current,
                title: patch?.title ?? current.title,
                updatedAt: patch?.updatedAt ?? current.updatedAt,
              };
            }),
        },
        feedParser: {
          parse: () => Effect.succeed(feed([tied, known], 'Updated')),
        },
        processor: {
          sanitize: (document) => {
            processed.push(document.body.innerHTML);

            return Effect.succeed(decodeContent(document.body.innerHTML));
          },
        },
        items: {
          inventory: () => Effect.succeed(inventory),
          create: (items) =>
            Effect.sync(() => {
              events.push('articles');
              created.push(items);

              return items.map((item) => item.id);
            }),
          retain: (_feedId, ids) =>
            Effect.sync(() => {
              events.push('retain');
              retained.push(ids);
            }),
        },
      }
    );
  }
);

it.effect('keeps the configured retention and drops older new articles', () => {
  const hex = (value: number) => value.toString(16).padStart(64, '0');
  const inventory: Array<FeedItemBoundary> = Array.from(
    { length: 100 },
    (_, index) => ({
      id: FeedItemId.make(hex(index)),
      publishedAt: at(new Date(nowMillis + index * 60_000).toISOString()),
    })
  );
  const created: Array<ReadonlyArray<FeedItem>> = [];
  const retained: Array<ReadonlyArray<FeedItemId>> = [];
  let processed = false;

  return provide(
    Effect.gen(function* () {
      yield* refreshFeed(alice, id);
      expect(created).toEqual([]);
      expect(processed).toBe(false);
      expect(retained[0]).toHaveLength(50);
      expect(retained[0]?.[0]).toBe(FeedItemId.make(hex(99)));
      expect(retained[0]?.[49]).toBe(FeedItemId.make(hex(50)));
    }),
    {
      settings: {
        get: () => Effect.succeed(settingsValue(decodeRetention(50))),
      },
      feeds: {
        find: () => Effect.succeed(Option.some(storedFeed())),
        update: () => Effect.void,
      },
      feedParser: {
        parse: () =>
          Effect.succeed(
            feed([entry({ publishedAt: at('2026-01-01T00:00:00.000Z') })])
          ),
      },
      processor: {
        sanitize: () => {
          processed = true;

          return Effect.succeed(decodeContent(undefined));
        },
      },
      items: {
        inventory: () => Effect.succeed(inventory),
        create: (items) => {
          created.push(items);

          return Effect.succeed(items.map((item) => item.id));
        },
        retain: (_feedId, ids) => {
          retained.push(ids);

          return Effect.void;
        },
      },
    }
  );
});

it.effect(
  'evicts the lowest ids first among existing articles tied on time',
  () => {
    const hex = (value: number) => value.toString(16).padStart(64, '0');
    const inventory: Array<FeedItemBoundary> = Array.from(
      { length: 35 },
      (_, index) => ({
        id: FeedItemId.make(hex(index)),
        publishedAt: at('2026-01-02T00:00:00.000Z'),
      })
    );
    const retained: Array<ReadonlyArray<FeedItemId>> = [];

    return provide(
      Effect.gen(function* () {
        yield* refreshFeed(alice, id);
        expect(retained[0]).toHaveLength(30);
        expect(retained[0]?.[0]).toBe(FeedItemId.make(hex(34)));
        expect(retained[0]?.[29]).toBe(FeedItemId.make(hex(5)));
      }),
      {
        settings: {
          get: () => Effect.succeed(settingsValue(decodeRetention(30))),
        },
        feeds: {
          find: () => Effect.succeed(Option.some(storedFeed())),
          update: () => Effect.void,
        },
        feedParser: {
          parse: () =>
            Effect.succeed(
              feed([entry({ publishedAt: at('2026-01-01T00:00:00.000Z') })])
            ),
        },
        processor: {
          sanitize: () => Effect.succeed(decodeContent(undefined)),
        },
        items: {
          inventory: () => Effect.succeed(inventory),
          create: (items) => Effect.succeed(items.map((item) => item.id)),
          retain: (_feedId, ids) => {
            retained.push(ids);

            return Effect.void;
          },
        },
      }
    );
  }
);

it.effect(
  'imports the newest copy when a feed repeats an article identity',
  () => {
    const created: Array<ReadonlyArray<FeedItem>> = [];
    const retained: Array<ReadonlyArray<FeedItemId>> = [];
    const repeated = decodeUrl('https://example.com/repeated');
    const stale = entry({
      title: decodeTitle('Repeated'),
      url: Option.some(repeated),
      publishedAt: at('2026-01-01T00:00:00.000Z'),
    });
    const newest = entry({
      title: decodeTitle('Repeated'),
      url: Option.some(repeated),
      publishedAt: at('2026-01-05T00:00:00.000Z'),
    });
    const newestId = feedItemId({
      feedId: id,
      url: Option.some(repeated),
      title: newest.title,
      description: newest.description,
    });

    return provide(
      Effect.gen(function* () {
        yield* TestClock.setTime(nowMillis);
        yield* refreshFeed(alice, id);
        expect(created[0]?.map((item) => item.title)).toEqual(['Repeated']);
        expect(created[0]?.[0]?.publishedAt).toEqual(
          at('2026-01-05T00:00:00.000Z')
        );
        expect(retained[0]).toEqual([newestId]);
      }),
      {
        settings: {
          get: () => Effect.succeed(settingsValue(decodeRetention(100))),
        },
        feeds: {
          find: () => Effect.succeed(Option.some(storedFeed())),
          update: () => Effect.void,
        },
        feedParser: {
          parse: () => Effect.succeed(feed([stale, newest])),
        },
        items: {
          inventory: () => Effect.succeed([]),
          create: (items) => {
            created.push(items);

            return Effect.succeed(items.map((item) => item.id));
          },
          retain: (_feedId, ids) => {
            retained.push(ids);

            return Effect.void;
          },
        },
      }
    );
  }
);

it.effect(
  'retains the newest duplicated article over older existing ones',
  () => {
    const created: Array<ReadonlyArray<FeedItem>> = [];
    const retained: Array<ReadonlyArray<FeedItemId>> = [];
    const repeated = decodeUrl('https://example.com/repeated');
    const stale = entry({
      title: decodeTitle('Repeated'),
      url: Option.some(repeated),
      publishedAt: at('2026-01-01T00:00:00.000Z'),
    });
    const fresh = entry({
      title: decodeTitle('Fresh'),
      url: Option.some(decodeUrl('https://example.com/fresh')),
      publishedAt: at('2026-01-15T00:00:00.000Z'),
    });
    const newest = entry({
      title: decodeTitle('Repeated'),
      url: Option.some(repeated),
      publishedAt: at('2026-01-20T00:00:00.000Z'),
    });
    const newestId = feedItemId({
      feedId: id,
      url: Option.some(repeated),
      title: newest.title,
      description: newest.description,
    });
    const freshId = feedItemId({
      feedId: id,
      url: fresh.url,
      title: fresh.title,
      description: decodeDescription(undefined),
    });
    const inventory: Array<FeedItemBoundary> = [
      {
        id: FeedItemId.make('c'.repeat(64)),
        publishedAt: at('2026-01-10T00:00:00.000Z'),
      },
      {
        id: FeedItemId.make('d'.repeat(64)),
        publishedAt: at('2026-01-09T00:00:00.000Z'),
      },
    ];

    return provide(
      Effect.gen(function* () {
        yield* TestClock.setTime(nowMillis);
        yield* refreshFeed(alice, id);
        expect(created[0]?.map((item) => item.title)).toEqual([
          'Repeated',
          'Fresh',
        ]);
        expect(created[0]?.[0]?.publishedAt).toEqual(
          at('2026-01-20T00:00:00.000Z')
        );
        expect(retained[0]).toEqual([
          newestId,
          freshId,
          FeedItemId.make('c'.repeat(64)),
          FeedItemId.make('d'.repeat(64)),
        ]);
      }),
      {
        settings: {
          get: () => Effect.succeed(settingsValue(decodeRetention(100))),
        },
        feeds: {
          find: () => Effect.succeed(Option.some(storedFeed())),
          update: () => Effect.void,
        },
        feedParser: {
          parse: () => Effect.succeed(feed([stale, fresh, newest])),
        },
        items: {
          inventory: () => Effect.succeed(inventory),
          create: (items) => {
            created.push(items);

            return Effect.succeed(items.map((item) => item.id));
          },
          retain: (_feedId, ids) => {
            retained.push(ids);

            return Effect.void;
          },
        },
      }
    );
  }
);

it.effect('propagates a refresh write failure', () =>
  provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(refreshFeed(alice, id));
      expect(error._tag).toBe('FeedItemRepositoryError');
      expect(error).toMatchObject({ message: 'retain failed' });
    }),
    {
      settings: {
        get: () => Effect.succeed(settingsValue(decodeRetention(100))),
      },
      feeds: {
        find: () => Effect.succeed(Option.some(storedFeed())),
      },
      feedParser: { parse: () => Effect.succeed(feed([])) },
      items: {
        inventory: () => Effect.succeed([]),
        retain: () =>
          Effect.fail(
            new FeedItemRepositoryError({ message: 'retain failed' })
          ),
      },
    }
  )
);
