import { render } from '@solidjs/web';
import { createSignal, flush } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FeedItem } from '../src/api';
import { ArticleListBody } from '../src/components/ArticleListBody';
import * as state from '../src/state';
import { prependRow } from '../src/state/library-store';
import { jsonResponse, makeFeed, uuid } from './support/state-fixture';
import { installResizeObserver, sizeScroller } from './support/virtual-helpers';

let dispose: (() => void) | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

const BOUNDARY = '019363b8-0000-7000-8000-000000000000';

const item = (id: string): FeedItem => ({
  id,
  feedId: uuid(1001),
  url: `https://example.com/${id}`,
  title: `Item ${id}`,
  description: '<p>summary</p>',
  read: false,
});

const respond = (body: unknown): void => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
};

const mountList = (
  openId: () => string | null,
  scope: state.LibraryScope = { kind: 'all' }
): HTMLDivElement => {
  const notifyResize = installResizeObserver();
  const container = document.createElement('div');
  document.body.append(container);
  dispose = render(
    () => (
      <ArticleListBody
        ids={state.rowIds()}
        scope={scope}
        unreadOnly={false}
        openArticleId={openId()}
        onNavigate={() => undefined}
      />
    ),
    container
  );
  flush();
  const scroller = container.querySelector<HTMLDivElement>('.overflow-y-auto');
  if (scroller === null) throw new Error('missing scroller');
  sizeScroller(scroller, 2000);
  notifyResize(scroller, 2000);
  flush();
  return scroller;
};

const rowRoot = (scroller: HTMLElement, id: string): HTMLElement | null =>
  scroller
    .querySelector(`a[href$="/${id}?all"]`)
    ?.closest<HTMLElement>('[class*="group/row"]') ?? null;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.innerHTML = '';
  state.markUnauthenticated();
  vi.unstubAllGlobals();
});

it('renders the group label inside the first available row and updates it when the feed loads', async () => {
  const first = uuid(21);
  const second = uuid(22);
  const missing = uuid(20);
  const feedId = item(first).feedId;
  respond({
    groups: [{ feedId, ids: [missing, first, second] }],
    boundary: BOUNDARY,
  });
  respond({ items: [item(first), item(second)] });
  await state.loadScopeFirstPage({ kind: 'all' }, false);
  const scroller = mountList(() => null);
  const label = () =>
    rowRoot(scroller, first)?.parentElement?.firstElementChild;
  expect(label()?.textContent).not.toBe('Late title');

  respond({ items: [makeFeed({ id: feedId, title: 'Late title' })] });
  respond({ items: [] });
  respond({ items: [], boundary: BOUNDARY });
  respond({ count: 0, boundary: BOUNDARY });
  await state.refreshSidebar();
  flush();
  expect(label()?.textContent).toBe('Late title');
  expect(label()?.closest('[data-index]')).toBe(
    rowRoot(scroller, first)?.parentElement
  );
  expect(rowRoot(scroller, second)?.previousElementSibling).toBeNull();
  expect(rowRoot(scroller, first)?.textContent).not.toContain('Late title');
  expect(rowRoot(scroller, second)?.textContent).not.toContain('Late title');
});

it('fetches restored folder rows after reaching the end during a pending move', async () => {
  const folderId = uuid(2000);
  const scope = { kind: 'folder', folderId } as const;
  const sibling = item(uuid(21));
  const movedFeed = makeFeed({ id: uuid(1002), folderId });
  const restored = { ...item(uuid(22)), feedId: movedFeed.id };
  respond({
    boundary: BOUNDARY,
    groups: [
      {
        feedId: sibling.feedId,
        ids: [
          sibling.id,
          ...Array.from({ length: 29 }, (_, i) => uuid(400 + i)),
        ],
      },
      { feedId: restored.feedId, ids: [restored.id] },
    ],
  });
  respond({ items: [sibling] });
  await state.loadScopeFirstPage(scope, false);

  const move = Promise.withResolvers<Response>();
  fetchMock.mockReturnValueOnce(move.promise);
  const moving = state.moveFeedToFolder(movedFeed, null);
  const scroller = mountList(() => null, scope);
  Object.defineProperty(scroller, 'scrollHeight', {
    configurable: true,
    get: () => scroller.clientHeight,
  });
  scroller.dispatchEvent(new Event('scroll'));
  flush();
  expect(rowRoot(scroller, sibling.id)).not.toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(3);

  respond({ items: [restored] });
  move.resolve(jsonResponse({ error: 'RequestFailed' }, 500));
  expect(await moving).toBe(false);

  await vi.waitFor(() => {
    expect(rowRoot(scroller, restored.id)).not.toBeNull();
  });
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(fetchMock.mock.calls[3]?.[0]).toBe(
    `/api/feed-items?ids=${restored.id}`
  );
});

it('keeps one row node per article across read, content, paging, and prepend updates', async () => {
  const ids = [
    uuid(1007),
    uuid(1008),
    ...Array.from({ length: 28 }, (_, index) => uuid(400 + index)),
    uuid(1009),
  ];
  respond({ groups: [{ feedId: uuid(1001), ids }], boundary: BOUNDARY });
  respond({ items: [item(uuid(1007)), item(uuid(1008))] });
  await state.loadScopeFirstPage({ kind: 'all' }, false);
  const [openId, setOpenId] = createSignal<string | null>(null);
  const scroller = mountList(openId);
  const row = rowRoot(scroller, uuid(1007));
  expect(row).not.toBeNull();
  expect(row?.hasAttribute('data-read')).toBe(false);

  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await state.toggleArticleRead(uuid(1007), true);
  flush();
  expect(rowRoot(scroller, uuid(1007))).toBe(row);
  expect(row?.hasAttribute('data-read')).toBe(true);
  expect(row?.querySelector('button')?.getAttribute('aria-pressed')).toBe(
    'true'
  );

  state.patchArticleLocal(uuid(1007), { extractedContent: '<p>full</p>' });
  flush();
  expect(rowRoot(scroller, uuid(1007))).toBe(row);

  respond({ items: [item(uuid(1009))] });
  await state.loadMore();
  flush();
  expect(rowRoot(scroller, uuid(1009))).not.toBeNull();
  expect(rowRoot(scroller, uuid(1007))).toBe(row);

  prependRow({ kind: 'feed', ...item('i0') });
  flush();
  expect(rowRoot(scroller, 'i0')).not.toBeNull();
  expect(rowRoot(scroller, uuid(1007))).toBe(row);
  expect(row?.closest('[data-index]')?.getAttribute('data-index')).toBe('1');

  setOpenId(uuid(1007));
  flush();
  expect(rowRoot(scroller, uuid(1007))).toBe(row);
  expect(row?.querySelector('.bg-neutral')).not.toBeNull();
  expect(row?.hasAttribute('data-read')).toBe(true);
});
