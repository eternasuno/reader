import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStateTestContext,
  feedOrder,
  makeFeed,
  makeItem,
  noContentResponse as noContent,
  uuid,
} from './support/state-fixture';

const B = '019363b8-0000-7000-8000-000000000001';
const queuePage = (items: Array<ReturnType<typeof makeItem>>): void => {
  queue(feedOrder(items, B));
  if (items.length > 0) queue({ items });
};

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
    const feedA = makeFeed({ id: uuid(1005) });
    await queueLoadedLibrary({
      scope: { kind: 'feed', feedId: uuid(1005) },
      items: [makeItem({ id: uuid(1011), feedId: uuid(1005) })],
      feeds: [feedA],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const del = pending();
    const onNavigate = vi.fn();
    const run = deleteFeed({ unreadOnly: false, onNavigate }, feedA);
    queue({ ids: [], boundary: B });
    await state.loadScopeFirstPage({ kind: 'later' }, false);
    del.resolve(noContent());
    await run;

    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('navigates to /all when deleting the currently viewed feed', async () => {
    const { deleteFeed } = await import('../src/components/articleListActions');
    const feedA = makeFeed({ id: uuid(1005) });
    await queueLoadedLibrary({
      scope: { kind: 'feed', feedId: uuid(1005) },
      items: [makeItem({ id: uuid(1011), feedId: uuid(1005) })],
      feeds: [feedA],
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    queueEmpty();
    const onNavigate = vi.fn();

    await deleteFeed({ unreadOnly: false, onNavigate }, feedA);

    expect(onNavigate).toHaveBeenCalledWith('/all?all');
  });
});

describe('deleteFeed open article guard', () => {
  it('closes an open article from the deleted feed without switching away from the active aggregate scope', async () => {
    const { deleteFeed } = await import('../src/components/articleListActions');
    const feedA = makeFeed({ id: uuid(1005) });
    const feedB = makeFeed({ id: uuid(1006) });
    await queueLoadedLibrary({
      scope: { kind: 'all' },
      items: [
        makeItem({ id: uuid(1011), feedId: uuid(1005) }),
        makeItem({ id: uuid(1013), feedId: uuid(1006) }),
      ],
      feeds: [feedA, feedB],
    });
    queue({ item: makeItem({ id: uuid(1011), feedId: uuid(1005) }) });
    await state.openArticleByRoute({ kind: 'all' }, uuid(1011));

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    queueEmpty();
    queuePage([makeItem({ id: uuid(1013), feedId: uuid(1006) })]);
    const onNavigate = vi.fn();

    await deleteFeed({ unreadOnly: false, onNavigate }, feedA);

    expect(onNavigate).toHaveBeenCalledWith('/all?all');
  });

  it('does not navigate when deleting a feed while viewing a folder and another feed item is open', async () => {
    const { deleteFeed } = await import('../src/components/articleListActions');
    const feedA = makeFeed({ id: uuid(1005), folderId: 'dir-1' });
    const feedB = makeFeed({ id: uuid(1006), folderId: 'dir-1' });
    await queueLoadedLibrary({
      scope: { kind: 'folder', folderId: 'dir-1' },
      items: [
        makeItem({ id: uuid(1011), feedId: uuid(1005) }),
        makeItem({ id: uuid(1013), feedId: uuid(1006) }),
      ],
      feeds: [feedA, feedB],
    });
    queue({ item: makeItem({ id: uuid(1013), feedId: uuid(1006) }) });
    await state.openArticleByRoute(
      { kind: 'folder', folderId: 'dir-1' },
      uuid(1013)
    );

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    queueEmpty();
    queuePage([makeItem({ id: uuid(1013), feedId: uuid(1006) })]);
    const onNavigate = vi.fn();

    await deleteFeed({ unreadOnly: false, onNavigate }, feedA);

    expect(onNavigate).not.toHaveBeenCalled();
  });
});
