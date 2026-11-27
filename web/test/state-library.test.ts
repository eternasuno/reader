import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  feedOrder,
  makeFeed,
  makeItem,
  makePage,
  uuid,
} from './support/state-fixture';

const B = '019363b8-0000-7000-8000-000000000001';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

describe('first page load', () => {
  it('loads the saved-page snapshot and initial batch', async () => {
    const { state } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [
        makePage({ id: uuid(1018) }),
        makePage({ id: uuid(1019), read: true }),
      ],
    });

    expect(ctx.requestUrl()).toBe('/api/saved-pages/order?unread=false');
    expect(state.rows()).toHaveLength(2);
    expect(state.rows()[0].kind).toBe('later');
    expect(state.articleSource(state.rows()[0])).toEqual({
      title: 'example.com',
      iconSrcs: ['https://example.com/favicon.ico'],
    });
    expect(state.activeScope()).toEqual({ kind: 'later' });
    expect(state.loadingInitial()).toBe(false);
    expect(state.loadError()).toBeNull();
  });
});

describe('first page params', () => {
  it('passes unread on single-feed snapshots', async () => {
    const { state, solid } = ctx;
    ctx.queue(feedOrder([], B));
    await state.loadScopeFirstPage({ kind: 'feed', feedId: uuid(1001) }, true);
    solid.flush();
    expect(ctx.requestUrl()).toBe(
      `/api/feeds/${uuid(1001)}/items/order?unread=true`
    );
    expect(state.listBoundary()).toBe(B);
    expect(state.activeUnreadOnly()).toBe(true);
  });
});

describe('scope endpoints', () => {
  it('uses the folder and all-feeds endpoints', async () => {
    const { state, solid } = ctx;
    const items = [makeItem({ id: uuid(1007), feedId: uuid(1001) })];
    ctx.queue(feedOrder(items, B));
    ctx.queue({ items });
    await state.loadScopeFirstPage({ kind: 'folder', folderId: 'd1' }, false);
    solid.flush();
    expect(ctx.requestUrl()).toBe('/api/folders/d1/items/order?unread=false');
    expect(state.rows()[0].kind).toBe('feed');

    ctx.queue(feedOrder([], B));
    await state.loadScopeFirstPage({ kind: 'all' }, false);
    expect(ctx.requestUrl(2)).toBe('/api/feed-items/order?unread=false');
    expect(state.rows()).toHaveLength(0);
  });
});

describe('row labels', () => {
  it('labels feed rows with feed title and icon candidates', async () => {
    const { state } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: uuid(1007), feedId: uuid(1001) }),
        makeItem({ id: uuid(1008), feedId: uuid(1002) }),
      ],
      feeds: [
        makeFeed({
          id: uuid(1001),
          title: 'Go Blog',
          url: 'https://go.dev/blog/feed.atom',
          siteUrl: 'https://go.dev/blog/',
          iconUrl: 'https://go.dev/images/go-logo.png',
        }),
        makeFeed({
          id: uuid(1002),
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
        makeItem({ id: uuid(1007), feedId: uuid(1001) }),
        makeItem({ id: uuid(1008), feedId: uuid(1002) }),
        makeItem({ id: uuid(1009), feedId: uuid(1003) }),
      ],
      feeds: [
        makeFeed({
          id: uuid(1001),
          title: 'Generated',
          url: 'https://rsshub.example/twitter/user/alice',
          siteUrl: 'https://twitter.example/alice',
        }),
        makeFeed({
          id: uuid(1002),
          title: 'No site',
          url: 'https://rsshub.example/blog/bob',
        }),
        makeFeed({
          id: uuid(1003),
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
        makeItem({ id: uuid(1007), feedId: uuid(1001) }),
        makeItem({ id: uuid(1008), feedId: uuid(1015) }),
      ],
      feeds: [
        makeFeed({
          id: uuid(1001),
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
