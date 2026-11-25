import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStateTestContext,
  makeFeed,
  makeItem,
  noContentResponse as noContent,
} from './support/state-fixture';

const context = createStateTestContext();
const { queue, queueEmpty, pending, queueLoadedLibrary } = context;
let state: typeof context.state;
let releaseMount: () => void = () => {};

const unmountLibrary = (): void => {
  releaseMount();
  releaseMount = () => {};
};

beforeEach(async () => {
  await context.reset();
  state = context.state;
  releaseMount = state.trackLibraryMount();
});

afterEach(unmountLibrary);

describe('deleteFeed scope guard', () => {
  it('skips navigating to /all if scope changed while unsubscribe ran', async () => {
    const { deleteFeed } = await import('../src/components/articleListActions');
    const feedA = makeFeed({ id: 'fA' });
    await queueLoadedLibrary({
      scope: { kind: 'feed', feedId: 'fA' },
      items: [makeItem({ id: 'iA1', feedId: 'fA' })],
      feeds: [feedA],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const del = pending();
    const onNavigate = vi.fn();
    const run = deleteFeed({ unreadOnly: false, onNavigate }, feedA);
    queue({ items: [], cursor: null });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    del.resolve(noContent());
    await run;

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('navigates to /all when deleting the currently viewed feed', async () => {
    const { deleteFeed } = await import('../src/components/articleListActions');
    const feedA = makeFeed({ id: 'fA' });
    await queueLoadedLibrary({
      scope: { kind: 'feed', feedId: 'fA' },
      items: [makeItem({ id: 'iA1', feedId: 'fA' })],
      feeds: [feedA],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    queueEmpty();
    const onNavigate = vi.fn();

    await deleteFeed({ unreadOnly: true, onNavigate }, feedA);

    expect(onNavigate).toHaveBeenCalledWith('/all?unread');
  });
});

describe('deleteFeed open article guard', () => {
  it('closes an open article from the deleted feed without switching away from the active aggregate scope', async () => {
    const { deleteFeed } = await import('../src/components/articleListActions');
    const feedA = makeFeed({ id: 'fA' });
    const feedB = makeFeed({ id: 'fB' });
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: 'iA1', feedId: 'fA' }),
        makeItem({ id: 'iB1', feedId: 'fB' }),
      ],
      feeds: [feedA, feedB],
    });
    queue({ item: makeItem({ id: 'iA1', feedId: 'fA' }) });
    await state.openArticleByRoute({ kind: 'all' }, 'iA1');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    queueEmpty();
    queue({ items: [makeItem({ id: 'iB1', feedId: 'fB' })], cursor: null });
    const onNavigate = vi.fn();

    await deleteFeed({ unreadOnly: true, onNavigate }, feedA);

    expect(onNavigate).toHaveBeenCalledWith('/all?unread');
  });

  it('does not navigate when deleting a feed while viewing a folder and another feed item is open', async () => {
    const { deleteFeed } = await import('../src/components/articleListActions');
    const feedA = makeFeed({ id: 'fA', folderId: 'dir-1' });
    const feedB = makeFeed({ id: 'fB', folderId: 'dir-1' });
    await queueLoadedLibrary({
      scope: { kind: 'folder', folderId: 'dir-1' },
      items: [
        makeItem({ id: 'iA1', feedId: 'fA' }),
        makeItem({ id: 'iB1', feedId: 'fB' }),
      ],
      feeds: [feedA, feedB],
    });
    queue({ item: makeItem({ id: 'iB1', feedId: 'fB' }) });
    await state.openArticleByRoute(
      { kind: 'folder', folderId: 'dir-1' },
      'iB1'
    );

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    queueEmpty();
    queue({ items: [makeItem({ id: 'iB1', feedId: 'fB' })], cursor: null });
    const onNavigate = vi.fn();

    await deleteFeed({ unreadOnly: false, onNavigate }, feedA);

    expect(onNavigate).not.toHaveBeenCalled();
  });
});
