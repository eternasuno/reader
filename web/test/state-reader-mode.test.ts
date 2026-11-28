import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  makeFeed,
  makeItem,
  makePage,
  requireArticle,
  uuid,
} from './support/state-fixture';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

describe('feed starting mode', () => {
  it('starts a feed item in its feed reader mode and extracts automatically', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'feed', feedId: uuid(1001) },
      items: [makeItem({ id: uuid(1007), feedId: uuid(1001), read: true })],
      feeds: [makeFeed({ id: uuid(1001), readerMode: 'extracted' })],
    });

    ctx.queue({
      item: makeItem({ id: uuid(1007), feedId: uuid(1001), read: true }),
    });
    ctx.queue({
      item: makeItem({
        id: uuid(1007),
        feedId: uuid(1001),
        read: true,
        extractedContent: '<p>x</p>',
      }),
    });

    await state.openArticleByRoute(
      { kind: 'feed', feedId: uuid(1001) },
      uuid(1007)
    );
    solid.flush();

    expect(state.displayMode()).toBe('extracted');
    const opened = state.openArticle();
    expect(
      opened !== null && opened.kind === 'feed'
        ? opened.extractedContent
        : undefined
    ).toBe('<p>x</p>');
    const firstRow = requireArticle(state, state.rowIds()[0]);
    expect(
      firstRow.kind === 'feed' ? firstRow.extractedContent : undefined
    ).toBe('<p>x</p>');
    expect(ctx.requestUrl(ctx.fetchCount() - 1)).toBe(
      `/api/feed-items/${uuid(1007)}/extract`
    );
    expect(state.extracting()).toBe(false);
  });
});

describe('cold deep link: resolves feed mode', () => {
  it('renders article text immediately and commits feed readerMode once sidebar resolves', async () => {
    const { state, solid } = ctx;
    const sidebarPending = ctx.queueDeferredSidebar({
      feeds: [makeFeed({ id: uuid(1001), readerMode: 'extracted' })],
    });

    const sidebarPromise = state.refreshSidebar();
    ctx.queue({
      item: makeItem({
        id: uuid(1007),
        feedId: uuid(1001),
        read: true,
        title: 'Item i1',
      }),
    });

    const opening = state.openArticleByRoute(
      { kind: 'feed', feedId: uuid(1001) },
      uuid(1007)
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    solid.flush();
    expect(state.openArticle()?.title).toBe('Item i1');
    expect(state.loadingArticle()).toBe(false);

    ctx.queue({
      item: makeItem({
        id: uuid(1007),
        feedId: uuid(1001),
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
      feeds: [makeFeed({ id: uuid(1001), readerMode: 'extracted' })],
    });

    const sidebarPromise = state.refreshSidebar();
    ctx.queue({
      item: makeItem({ id: uuid(1007), feedId: uuid(1001), read: true }),
    });
    const opening = state.openArticleByRoute(
      { kind: 'feed', feedId: uuid(1001) },
      uuid(1007)
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    solid.flush();
    expect(state.openArticle()?.id).toBe(uuid(1007));

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
  it('starts saved pages in default and honours the extracted feed mode', async () => {
    const { state, solid } = ctx;
    ctx.queue({ item: makePage({ id: uuid(1018), read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, uuid(1018));
    solid.flush();
    expect(state.displayMode()).toBe('default');

    const cached = makeItem({
      id: uuid(1007),
      feedId: uuid(1001),
      read: true,
      extractedContent: '<p>cached</p>',
    });
    await ctx.queueLoadedLibrary({
      scope: { kind: 'feed', feedId: uuid(1001) },
      items: [cached],
      feeds: [makeFeed({ id: uuid(1001), readerMode: 'extracted' })],
    });
    ctx.queue({ item: cached });
    await state.openArticleByRoute(
      { kind: 'feed', feedId: uuid(1001) },
      uuid(1007)
    );
    solid.flush();
    expect(state.displayMode()).toBe('extracted');
  });
});

describe('extracted toggle', () => {
  it('toggles extracted mode and reuses cached content', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'feed', feedId: uuid(1001) },
      items: [
        makeItem({
          id: uuid(1007),
          feedId: uuid(1001),
          read: true,
          extractedContent: '<p>cached</p>',
        }),
      ],
      feeds: [makeFeed({ id: uuid(1001) })],
    });
    ctx.queue({
      item: makeItem({
        id: uuid(1007),
        feedId: uuid(1001),
        read: true,
        extractedContent: '<p>cached</p>',
      }),
    });
    await state.openArticleByRoute(
      { kind: 'feed', feedId: uuid(1001) },
      uuid(1007)
    );
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
