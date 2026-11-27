import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  jsonResponse,
  makeFeed,
  makeItem,
  makePage,
  savedOrder,
  uuid,
} from './support/state-fixture';

const BOUNDARY = '019363b8-0000-7000-8000-000000000000';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

describe('extraction failure', () => {
  it('reverts to default and toasts when extraction fails', async () => {
    const { state, solid, ui, i18n } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'feed', feedId: uuid(1001) },
      items: [makeItem({ id: uuid(1007), feedId: uuid(1001), read: true })],
      feeds: [makeFeed({ id: uuid(1001) })],
    });
    ctx.queue({
      item: makeItem({ id: uuid(1007), feedId: uuid(1001), read: true }),
    });
    await state.openArticleByRoute(
      { kind: 'feed', feedId: uuid(1001) },
      uuid(1007)
    );
    solid.flush();

    ctx.queue({ error: 'ArticleEmptyContent' }, 422);
    await state.toggleExtractedMode();
    solid.flush();

    expect(state.displayMode()).toBe('default');
    expect(state.extracting()).toBe(false);
    expect(ui.currentToast()?.message).toBe(
      i18n.translateErrorCode('ArticleEmptyContent')
    );
  });
});

describe('extraction deduplication', () => {
  it('does not start a second POST when toggling back to original and back', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'feed', feedId: uuid(1001) },
      items: [makeItem({ id: uuid(1007), feedId: uuid(1001), read: true })],
      feeds: [makeFeed({ id: uuid(1001) })],
    });
    ctx.queue({
      item: makeItem({ id: uuid(1007), feedId: uuid(1001), read: true }),
    });
    await state.openArticleByRoute(
      { kind: 'feed', feedId: uuid(1001) },
      uuid(1007)
    );
    solid.flush();

    const extractPending = ctx.pending();
    const first = state.toggleExtractedMode();
    const callsAfterStart = ctx.fetchCount();
    expect(state.extracting()).toBe(true);
    await state.toggleExtractedMode();
    expect(state.displayMode()).toBe('default');

    const second = state.toggleExtractedMode();
    expect(state.displayMode()).toBe('extracted');
    expect(ctx.fetchCount()).toBe(callsAfterStart);

    const extractedItem = makeItem({
      id: uuid(1007),
      feedId: uuid(1001),
      read: true,
      extractedContent: '<p>extracted</p>',
    });
    extractPending.resolve(jsonResponse({ item: extractedItem }));
    await Promise.all([first, second]);
    solid.flush();

    expect(state.extracting()).toBe(false);
    const opened = state.openArticle();
    expect(opened?.kind === 'feed' ? opened.extractedContent : undefined).toBe(
      '<p>extracted</p>'
    );
  });
});

const makeExtractedItem = (id: string, extractedContent: string) =>
  makeItem({ id, feedId: uuid(1001), read: true, extractedContent });

describe('extraction stale request guard', () => {
  it('does not let a stale extraction finally clear a newer extraction flag', async () => {
    const { state, solid } = ctx;
    const scope = { kind: 'feed', feedId: uuid(1001) } as const;
    await ctx.queueLoadedLibrary({
      scope,
      items: [
        makeItem({ id: uuid(1007), feedId: uuid(1001), read: true }),
        makeItem({ id: uuid(1008), feedId: uuid(1001), read: true }),
      ],
      feeds: [makeFeed({ id: uuid(1001) })],
    });

    ctx.queue({
      item: makeItem({ id: uuid(1007), feedId: uuid(1001), read: true }),
    });
    await state.openArticleByRoute(scope, uuid(1007));
    const extractA = ctx.pending();
    const runningA = state.toggleExtractedMode();
    expect(state.extracting()).toBe(true);

    ctx.queue({
      item: makeItem({ id: uuid(1008), feedId: uuid(1001), read: true }),
    });
    await state.openArticleByRoute(scope, uuid(1008));
    const extractB = ctx.pending();
    const runningB = state.toggleExtractedMode();
    expect(state.extracting()).toBe(true);

    extractA.resolve(
      jsonResponse({
        item: makeExtractedItem(uuid(1007), '<p>extracted A</p>'),
      })
    );
    await runningA;
    solid.flush();
    expect(state.extracting()).toBe(true);
    expect(state.openArticleId()).toBe(uuid(1008));
    expect(state.displayMode()).toBe('extracted');

    extractB.resolve(
      jsonResponse({
        item: makeExtractedItem(uuid(1008), '<p>extracted B</p>'),
      })
    );
    await runningB;
    solid.flush();
    expect(state.extracting()).toBe(false);
    expect(state.openArticleId()).toBe(uuid(1008));
    expect(state.displayMode()).toBe('extracted');
  });
});

describe('adjacent articles', () => {
  it('derives adjacent articles from the loaded list only', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [
        makePage({ id: uuid(1018), read: true }),
        makePage({ id: uuid(1019), read: true }),
        makePage({ id: uuid(1020), read: true }),
      ],
    });

    ctx.queue({ item: makePage({ id: uuid(1019), read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, uuid(1019));
    solid.flush();
    expect(state.adjacentArticleIds()).toEqual({
      prevId: uuid(1018),
      nextId: uuid(1020),
    });

    ctx.queue({ item: makePage({ id: uuid(1021), read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, uuid(1021));
    solid.flush();
    expect(state.adjacentArticleIds()).toEqual({ prevId: null, nextId: null });
  });
});

describe('record store sync and eviction', () => {
  it('keeps the open article in sync when toggling read state', async () => {
    const { state, solid } = ctx;
    ctx.queue({ item: makePage({ id: uuid(1021), read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, uuid(1021));
    solid.flush();
    expect(state.openArticle()?.read).toBe(true);

    ctx.queueEmpty();
    await state.toggleArticleRead(uuid(1021), false, {
      kind: 'later',
      read: true,
    });
    solid.flush();

    expect(state.openArticle()?.read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
  });

  it('retains deep-linked records across list reloads and evicts them when closed', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: uuid(1018), read: true })],
    });

    ctx.queue({ item: makePage({ id: uuid(1021), read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, uuid(1021));
    solid.flush();
    expect(state.articleById(uuid(1021))?.id).toBe(uuid(1021));

    // Reloading list evicts p1 (old list row) while retaining deep-linked p9 for the reader.
    const items = [makePage({ id: uuid(1019), read: true })];
    ctx.queue(savedOrder(items, BOUNDARY));
    ctx.queue({ items });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    solid.flush();
    expect(state.articleById(uuid(1018))).toBeNull();
    expect(state.articleById(uuid(1021))?.id).toBe(uuid(1021));
    expect(state.openArticle()?.id).toBe(uuid(1021));

    // Closing the reader evicts p9 since neither view needs it.
    await state.openArticleByRoute({ kind: 'later' }, null);
    solid.flush();
    expect(state.articleById(uuid(1021))).toBeNull();
    expect(state.articleById(uuid(1019))?.id).toBe(uuid(1019));
  });
});
