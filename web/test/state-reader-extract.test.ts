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
