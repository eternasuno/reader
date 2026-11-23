import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  makeFeed,
  makeItem,
  makePage,
} from './support/state-fixture';

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
      url: state.rows()[0].url,
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
    ctx.queue({ items: [], cursor: null });
    await state.loadScopeFirstPage(
      { kind: 'feed', feedId: 'f1' },
      true,
      'oldest'
    );
    solid.flush();

    expect(ctx.requestUrl()).toBe(
      '/api/feeds/f1/items?limit=30&unread=true&order=oldest'
    );
    expect(state.activeUnreadOnly()).toBe(true);
    expect(state.activeOrder()).toBe('oldest');
  });
});

describe('scope endpoints', () => {
  it('uses the folder and all-feeds endpoints', async () => {
    const { state, solid } = ctx;
    ctx.queue({ items: [makeItem({ id: 'i1', feedId: 'f1' })], cursor: null });
    await state.loadScopeFirstPage({ kind: 'folder', folderId: 'd1' }, false);
    solid.flush();
    expect(ctx.requestUrl()).toBe(
      '/api/folders/d1/items?limit=30&unread=false'
    );
    expect(state.rows()[0].kind).toBe('feed');

    ctx.queue({ items: [], cursor: null });
    await state.loadScopeFirstPage({ kind: 'all' }, false, 'oldest');
    solid.flush();
    expect(ctx.requestUrl(1)).toBe('/api/feed-items?limit=30&unread=false');
    expect(state.activeOrder()).toBe('newest');
    expect(state.rows()).toHaveLength(0);
  });
});

describe('row labels', () => {
  it('labels feed rows with the feed title', async () => {
    const { state } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [makeItem({ id: 'i1', feedId: 'f1' })],
      feeds: [makeFeed({ id: 'f1', title: 'Go Blog' })],
    });

    expect(state.rows()[0].kind).toBe('feed');
    expect(state.articleSource(state.rows()[0]).title).toBe('Go Blog');
  });
});

describe('shared list order', () => {
  it('reloads the active aggregate list oldest first and persists the choice', async () => {
    const { state, solid } = ctx;
    ctx.queue({ items: [], cursor: null });
    await state.loadScopeFirstPage({ kind: 'all' }, false);
    solid.flush();

    ctx.queue({ items: [], cursor: null });
    await state.toggleAggregateOrder();
    solid.flush();

    expect(ctx.requestUrl(1)).toBe(
      '/api/feed-items?limit=30&unread=false&order=oldest'
    );
    expect(state.activeOrder()).toBe('oldest');
    expect(state.aggregateOrder()).toBe('oldest');
    expect(localStorage.getItem('reader.listOrder')).toBe('oldest');

    ctx.queue({ items: [], cursor: null });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    solid.flush();
    expect(ctx.requestUrl(2)).toBe(
      '/api/saved-pages?limit=30&unread=false&order=oldest'
    );
  });
});
