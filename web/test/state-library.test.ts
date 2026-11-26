import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  makeFeed,
  makeItem,
  makePage,
} from './support/state-fixture';

const B = '019363b8-0000-7000-8000-000000000001';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

describe('first page load', () => {
  it('loads the first saved-page page with limit 30', async () => {
    const { state } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1' }), makePage({ id: 'p2', read: true })],
      cursor: 'p2',
    });

    expect(ctx.requestUrl()).toContain('/api/saved-pages?limit=30');
    expect(state.rows()).toHaveLength(2);
    expect(state.rows()[0].kind).toBe('later');
    expect(state.articleSource(state.rows()[0])).toEqual({
      title: 'example.com',
      iconSrcs: ['https://example.com/favicon.ico'],
    });
    expect(state.cursor()).toBe('p2');
    expect(state.activeScope()).toEqual({ kind: 'later' });
    expect(state.loadingInitial()).toBe(false);
    expect(state.loadError()).toBeNull();
  });
});

describe('first page params', () => {
  it('passes unread and order for single-feed lists', async () => {
    const { state, solid } = ctx;
    ctx.queue({ items: [], cursor: null, boundary: B });
    await state.loadScopeFirstPage(
      { kind: 'feed', feedId: 'f1' },
      true,
      'oldest'
    );
    solid.flush();

    expect(ctx.requestUrl()).toBe(
      '/api/feeds/f1/items?limit=30&unread=true&order=oldest'
    );
    expect(state.listBoundary()).toBe(B);
    expect(state.activeUnreadOnly()).toBe(true);
    expect(state.activeOrder()).toBe('oldest');
  });
});

describe('scope endpoints', () => {
  it('uses the folder and all-feeds endpoints', async () => {
    const { state, solid } = ctx;
    ctx.queue({
      items: [makeItem({ id: 'i1', feedId: 'f1' })],
      cursor: null,
      boundary: B,
    });
    await state.loadScopeFirstPage({ kind: 'folder', folderId: 'd1' }, false);
    solid.flush();
    expect(ctx.requestUrl()).toBe(
      '/api/folders/d1/items?limit=30&unread=false'
    );
    expect(state.rows()[0].kind).toBe('feed');

    ctx.queue({ items: [], cursor: null, boundary: B });
    await state.loadScopeFirstPage({ kind: 'all' }, false, 'oldest');
    solid.flush();
    expect(ctx.requestUrl(1)).toBe('/api/feed-items?limit=30&unread=false');
    expect(state.activeOrder()).toBe('newest');
    expect(state.rows()).toHaveLength(0);
  });
});

describe('row labels', () => {
  it('labels feed rows with feed title and icon candidates', async () => {
    const { state } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: 'i1', feedId: 'f1' }),
        makeItem({ id: 'i2', feedId: 'f2' }),
      ],
      feeds: [
        makeFeed({
          id: 'f1',
          title: 'Go Blog',
          url: 'https://go.dev/blog/feed.atom',
          siteUrl: 'https://go.dev/blog/',
          iconUrl: 'https://go.dev/images/go-logo.png',
        }),
        makeFeed({
          id: 'f2',
          title: 'Plain',
          url: 'https://plain.example/rss',
          siteUrl: 'https://plain.example/',
        }),
      ],
    });

    expect(state.rows()[0].kind).toBe('feed');
    expect(state.articleSource(state.rows()[0])).toEqual({
      title: 'Go Blog',
      iconSrcs: [
        'https://go.dev/images/go-logo.png',
        'https://go.dev/favicon.ico',
      ],
    });
    expect(state.articleSource(state.rows()[1])).toEqual({
      title: 'Plain',
      iconSrcs: ['https://plain.example/favicon.ico'],
    });
  });
});

describe('feed icon source', () => {
  it('never derives a feed icon from the subscribed feed URL', async () => {
    const { state } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: 'i1', feedId: 'f1' }),
        makeItem({ id: 'i2', feedId: 'f2' }),
        makeItem({ id: 'i3', feedId: 'f3' }),
      ],
      feeds: [
        makeFeed({
          id: 'f1',
          title: 'Generated',
          url: 'https://rsshub.example/twitter/user/alice',
          siteUrl: 'https://twitter.example/alice',
        }),
        makeFeed({
          id: 'f2',
          title: 'No site',
          url: 'https://rsshub.example/blog/bob',
        }),
        makeFeed({
          id: 'f3',
          title: 'Declared icon only',
          url: 'https://rsshub.example/blog/carol',
          iconUrl: 'https://carol.example/icon.png',
        }),
      ],
    });

    expect(state.articleSource(state.rows()[0]).iconSrcs).toEqual([
      'https://twitter.example/favicon.ico',
    ]);
    expect(state.articleSource(state.rows()[1]).iconSrcs).toEqual([]);
    expect(state.articleSource(state.rows()[2]).iconSrcs).toEqual([
      'https://carol.example/icon.png',
    ]);
  });
});

describe('feed icon candidates', () => {
  it('deduplicates feed iconUrl and returns empty candidates when feed is unknown', async () => {
    const { state } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: 'i1', feedId: 'f1' }),
        makeItem({ id: 'i2', feedId: 'missing' }),
      ],
      feeds: [
        makeFeed({
          id: 'f1',
          title: 'Favicon Feed',
          url: 'https://fav.example/rss.xml',
          siteUrl: 'https://fav.example/',
          iconUrl: 'https://fav.example/favicon.ico',
        }),
      ],
    });

    expect(state.articleSource(state.rows()[0])).toEqual({
      title: 'Favicon Feed',
      iconSrcs: ['https://fav.example/favicon.ico'],
    });
    expect(state.articleSource(state.rows()[1])).toEqual({
      title: '',
      iconSrcs: [],
    });
  });
});

describe('shared list order', () => {
  it('reloads the active aggregate list oldest first and persists the choice', async () => {
    const { state, solid } = ctx;
    ctx.queue({ items: [], cursor: null, boundary: B });
    await state.loadScopeFirstPage({ kind: 'all' }, false);
    solid.flush();

    ctx.queue({ items: [], cursor: null, boundary: B });
    await state.toggleAggregateOrder();
    solid.flush();

    expect(ctx.requestUrl(1)).toBe(
      '/api/feed-items?limit=30&unread=false&order=oldest'
    );
    expect(state.activeOrder()).toBe('oldest');
    expect(state.aggregateOrder()).toBe('oldest');
    expect(localStorage.getItem('reader.listOrder')).toBe('oldest');

    ctx.queue({ items: [], cursor: null, boundary: B });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    solid.flush();
    expect(ctx.requestUrl(2)).toBe(
      '/api/saved-pages?limit=30&unread=false&order=oldest'
    );
  });
});
