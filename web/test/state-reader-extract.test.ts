import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStateTestContext,
  jsonResponse,
  makeFeed,
  makeItem,
  makePage,
} from './support/state-fixture';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

describe('extraction failure', () => {
  it('reverts to default and toasts when extraction fails', async () => {
    const { state, solid, ui, i18n } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'feed', feedId: 'f1' },
      items: [makeItem({ id: 'i1', feedId: 'f1', read: true })],
      feeds: [makeFeed({ id: 'f1' })],
    });
    ctx.queue({ item: makeItem({ id: 'i1', feedId: 'f1', read: true }) });
    await state.openArticleByRoute({ kind: 'feed', feedId: 'f1' }, 'i1');
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
      scope: { kind: 'feed', feedId: 'f1' },
      items: [makeItem({ id: 'i1', feedId: 'f1', read: true })],
      feeds: [makeFeed({ id: 'f1' })],
    });
    ctx.queue({ item: makeItem({ id: 'i1', feedId: 'f1', read: true }) });
    await state.openArticleByRoute({ kind: 'feed', feedId: 'f1' }, 'i1');
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
      id: 'i1',
      feedId: 'f1',
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
  makeItem({ id, feedId: 'f1', read: true, extractedContent });

describe('extraction stale request guard', () => {
  it('does not let a stale extraction finally clear a newer extraction flag', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'feed', feedId: 'f1' },
      items: [
        makeItem({ id: 'i1', feedId: 'f1', read: true }),
        makeItem({ id: 'i2', feedId: 'f1', read: true }),
      ],
      feeds: [makeFeed({ id: 'f1' })],
    });

    ctx.queue({ item: makeItem({ id: 'i1', feedId: 'f1', read: true }) });
    await state.openArticleByRoute({ kind: 'feed', feedId: 'f1' }, 'i1');
    const extractA = ctx.pending();
    const runningA = state.toggleExtractedMode();
    expect(state.extracting()).toBe(true);

    ctx.queue({ item: makeItem({ id: 'i2', feedId: 'f1', read: true }) });
    await state.openArticleByRoute({ kind: 'feed', feedId: 'f1' }, 'i2');
    const extractB = ctx.pending();
    const runningB = state.toggleExtractedMode();
    expect(state.extracting()).toBe(true);

    extractA.resolve(
      jsonResponse({ item: makeExtractedItem('i1', '<p>extracted A</p>') })
    );
    await runningA;
    solid.flush();
    expect(state.extracting()).toBe(true);
    expect(state.openArticleId()).toBe('i2');
    expect(state.displayMode()).toBe('extracted');

    extractB.resolve(
      jsonResponse({ item: makeExtractedItem('i2', '<p>extracted B</p>') })
    );
    await runningB;
    solid.flush();
    expect(state.extracting()).toBe(false);
    expect(state.openArticleId()).toBe('i2');
    expect(state.displayMode()).toBe('extracted');
  });
});

describe('adjacent articles', () => {
  it('derives adjacent articles from the loaded list only', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [
        makePage({ id: 'p1', read: true }),
        makePage({ id: 'p2', read: true }),
        makePage({ id: 'p3', read: true }),
      ],
    });

    ctx.queue({ item: makePage({ id: 'p2', read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, 'p2');
    solid.flush();
    expect(state.adjacentArticleIds()).toEqual({ prevId: 'p1', nextId: 'p3' });

    ctx.queue({ item: makePage({ id: 'p9', read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, 'p9');
    solid.flush();
    expect(state.adjacentArticleIds()).toEqual({ prevId: null, nextId: null });
  });
});

describe('record store sync and eviction', () => {
  it('keeps the open article in sync when toggling read state', async () => {
    const { state, solid } = ctx;
    ctx.queue({ item: makePage({ id: 'p9', read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, 'p9');
    solid.flush();
    expect(state.openArticle()?.read).toBe(true);

    ctx.queueEmpty();
    await state.toggleArticleRead('p9', false, { kind: 'later', read: true });
    solid.flush();

    expect(state.openArticle()?.read).toBe(false);
    expect(state.savedUnreadCount()).toBe(1);
  });

  it('retains deep-linked records across list reloads and evicts them when closed', async () => {
    const { state, solid } = ctx;
    await ctx.queueLoadedLibrary({
      scope: { kind: 'later' },
      items: [makePage({ id: 'p1', read: true })],
    });

    ctx.queue({ item: makePage({ id: 'p9', read: true }) });
    await state.openArticleByRoute({ kind: 'later' }, 'p9');
    solid.flush();
    expect(state.articleById('p9')?.id).toBe('p9');

    // Reloading list evicts p1 (old list row) while retaining deep-linked p9 for the reader.
    ctx.queue({ items: [makePage({ id: 'p2', read: true })], cursor: null });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    solid.flush();
    expect(state.articleById('p1')).toBeNull();
    expect(state.articleById('p9')?.id).toBe('p9');
    expect(state.openArticle()?.id).toBe('p9');

    // Closing the reader evicts p9 since neither view needs it.
    await state.openArticleByRoute({ kind: 'later' }, null);
    solid.flush();
    expect(state.articleById('p9')).toBeNull();
    expect(state.articleById('p2')?.id).toBe('p2');
  });
});
