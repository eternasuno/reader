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

describe('feed starting mode', () => {
  it('starts a feed item in its feed reader mode and extracts automatically', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'feed', feedId: 'f1' },
      items: [makeItem({ id: 'i1', feedId: 'f1', read: true })],
      feeds: [makeFeed({ id: 'f1', readerMode: 'extracted' })],
    });

    ctx.queue({ item: makeItem({ id: 'i1', feedId: 'f1', read: true }) });
    ctx.queue({
      item: makeItem({
        id: 'i1',
        feedId: 'f1',
        read: true,
        extractedContent: '<p>x</p>',
      }),
    });

    await state.openArticleByRoute({ kind: 'feed', feedId: 'f1' }, 'i1');
    solid.flush();

    expect(state.displayMode()).toBe('extracted');
    const opened = state.openArticle();
    expect(
      opened !== null && opened.kind === 'feed'
        ? opened.extractedContent
        : undefined
    ).toBe('<p>x</p>');
    const firstRow = state.rows()[0];
    expect(
      firstRow.kind === 'feed' ? firstRow.extractedContent : undefined
    ).toBe('<p>x</p>');
    expect(ctx.requestUrl(ctx.fetchCount() - 1)).toBe(
      '/api/feed-items/i1/extract'
    );
    expect(state.extracting()).toBe(false);
  });
});

describe('cold deep link: resolves feed mode', () => {
  it('renders article text immediately and commits feed readerMode once sidebar resolves', async () => {
    const { state, solid } = ctx;
    const sidebarPending = ctx.queueDeferredSidebar({
      feeds: [makeFeed({ id: 'f1', readerMode: 'extracted' })],
    });

    const sidebarPromise = state.refreshSidebar();
    ctx.queue({ item: makeItem({ id: 'i1', feedId: 'f1', read: true }) });

    const opening = state.openArticleByRoute(
      { kind: 'feed', feedId: 'f1' },
      'i1'
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    solid.flush();
    expect(state.openArticle()?.title).toBe('Item i1');
    expect(state.loadingArticle()).toBe(false);

    ctx.queue({
      item: makeItem({
        id: 'i1',
        feedId: 'f1',
        read: true,
        extractedContent: '<p>extracted</p>',
      }),
    });
    sidebarPending.resolve();
    await Promise.all([sidebarPromise, opening]);
    solid.flush();

    expect(state.displayMode()).toBe('extracted');
    const opened = state.openArticle();
    expect(
      opened !== null && opened.kind === 'feed'
        ? opened.extractedContent
        : undefined
    ).toBe('<p>extracted</p>');
  });
});

describe('cold deep link: preserves manual mode', () => {
  it('preserves manual mode changes made while cold deep-link feed preference is resolving', async () => {
    const { state, solid } = ctx;
    const sidebarPending = ctx.queueDeferredSidebar({
      feeds: [makeFeed({ id: 'f1', readerMode: 'extracted' })],
    });

    const sidebarPromise = state.refreshSidebar();
    ctx.queue({ item: makeItem({ id: 'i1', feedId: 'f1', read: true }) });
    const opening = state.openArticleByRoute(
      { kind: 'feed', feedId: 'f1' },
      'i1'
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    solid.flush();
    expect(state.openArticle()?.id).toBe('i1');

    state.toggleEmbeddedMode();
    solid.flush();
    expect(state.displayMode()).toBe('embedded');

    const beforeExtractCheck = ctx.fetchCount();
    sidebarPending.resolve();
    await Promise.all([sidebarPromise, opening]);
    solid.flush();

    expect(state.displayMode()).toBe('embedded');
    expect(ctx.fetchCount()).toBe(beforeExtractCheck);
  });
});

describe('saved and embedded modes', () => {
  it('starts saved pages in default and honours embedded feed mode', async () => {
    const { state, solid } = ctx;
    ctx.queue({ item: makePage({ id: 'p1', read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, 'p1');
    solid.flush();
    expect(state.displayMode()).toBe('default');

    await ctx.queueLoadedLibrary({
      scope: { kind: 'feed', feedId: 'f1' },
      items: [makeItem({ id: 'i1', feedId: 'f1', read: true })],
      feeds: [makeFeed({ id: 'f1', readerMode: 'embedded' })],
    });
    ctx.queue({ item: makeItem({ id: 'i1', feedId: 'f1', read: true }) });
    await state.openArticleByRoute({ kind: 'feed', feedId: 'f1' }, 'i1');
    solid.flush();
    expect(state.displayMode()).toBe('embedded');
  });
});

describe('extracted toggle', () => {
  it('toggles extracted mode and reuses cached content', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'feed', feedId: 'f1' },
      items: [
        makeItem({
          id: 'i1',
          feedId: 'f1',
          read: true,
          extractedContent: '<p>cached</p>',
        }),
      ],
      feeds: [makeFeed({ id: 'f1' })],
    });
    ctx.queue({
      item: makeItem({
        id: 'i1',
        feedId: 'f1',
        read: true,
        extractedContent: '<p>cached</p>',
      }),
    });
    await state.openArticleByRoute({ kind: 'feed', feedId: 'f1' }, 'i1');
    solid.flush();

    const before = ctx.fetchCount();
    await state.toggleExtractedMode();
    solid.flush();
    expect(state.displayMode()).toBe('extracted');
    expect(ctx.fetchCount()).toBe(before);

    await state.toggleExtractedMode();
    solid.flush();
    expect(state.displayMode()).toBe('default');
  });
});

describe('embedded toggle', () => {
  it('toggles embedded mode', () => {
    const { state, solid } = ctx;
    state.toggleEmbeddedMode();
    solid.flush();
    expect(state.displayMode()).toBe('embedded');

    state.toggleEmbeddedMode();
    solid.flush();
    expect(state.displayMode()).toBe('default');
  });
});
