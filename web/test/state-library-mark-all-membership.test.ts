import { beforeEach, describe, expect, it, vi } from 'vitest';
import { answerLibraryRead } from './support/mark-all-routes';
import {
  createStateTestContext,
  jsonResponse,
  makeFeed,
  makeFolder,
  makeItem,
  noContentResponse,
} from './support/state-fixture';

const B1 = '019363b8-0000-7000-8000-000000000001';
const B2 = '019363b8-0000-7000-8000-000000000002';
const ITEM_URL = `/api/feed-items/${B1}`;
const POST_URL = '/api/folders/A/read-all';

const ctx = createStateTestContext();

beforeEach(async () => {
  await ctx.reset();
});

/** `METHOD url` for every request sent so far, in send order. */
const requests = (): Array<string> =>
  ctx.fetchMock.mock.calls.map(
    ([url, init]) =>
      `${(init as RequestInit | undefined)?.method ?? 'GET'} ${String(url)}`
  );

/**
 * Holds the folder read-all POST until the returned settle callback runs; the server marks `B1`
 * read only when that POST settles. Other writes succeed at once.
 */
const routeFolderMarkAll = (): (() => void) => {
  let serverRead = false;
  let settlePost: () => void = () => {};
  ctx.fetchMock.mockImplementation((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (method === 'POST') {
      return new Promise<Response>((resolve) => {
        settlePost = () => {
          serverRead = true;
          resolve(noContentResponse());
        };
      });
    }
    if (method !== 'GET') return Promise.resolve(noContentResponse());
    if (url === ITEM_URL) {
      return Promise.resolve(
        jsonResponse({
          item: makeItem({ id: B1, feedId: 'f1', read: serverRead }),
        })
      );
    }
    if (url.startsWith('/api/folders/A/items')) {
      return Promise.resolve(
        jsonResponse({ items: [], cursor: null, boundary: B2 })
      );
    }
    return answerLibraryRead(url);
  });
  return () => settlePost();
};

describe('mark-all folder membership refresh', () => {
  it('refreshes the open article of a feed moved out of the folder after mark-all was sent', async () => {
    const { state, solid } = ctx;
    const release = state.trackLibraryMount();
    ctx.queueSidebar({
      feeds: [makeFeed({ id: 'f1', folderId: 'A' })],
      folders: [makeFolder('A')],
    });
    await state.refreshSidebar();
    ctx.queue({ items: [], cursor: null, boundary: B2 });
    await state.loadScopeFirstPage({ kind: 'folder', folderId: 'A' }, false);
    solid.flush();
    const settlePost = routeFolderMarkAll();

    await state.openArticleByRoute({ kind: 'folder', folderId: 'A' }, B1);
    const marking = state.markScopeAllRead({ kind: 'folder', folderId: 'A' });
    await vi.waitFor(() => expect(requests()).toContain(`POST ${POST_URL}`));
    await state.moveFeedToFolder(makeFeed({ id: 'f1', folderId: 'A' }), null);
    settlePost();
    await marking;
    solid.flush();

    const sent = requests();
    const post = sent.indexOf(`POST ${POST_URL}`);
    expect(sent.indexOf(`GET ${ITEM_URL}`, post)).toBeGreaterThan(post);
    expect(state.openArticle()?.read).toBe(true);
    release();
  });
});
