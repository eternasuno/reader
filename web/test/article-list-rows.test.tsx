import { render } from '@solidjs/web';
import { createSignal, flush } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FeedItem } from '../src/api';
import { ArticleListBody } from '../src/components/ArticleListBody';
import * as state from '../src/state';
import {
  jsonResponse,
  makeFeed,
  makePage,
  uuid,
} from './support/state-fixture';
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
  await vi.waitFor(() => expect(rowRoot(scroller, first)).not.toBeNull());
  const label = () =>
    rowRoot(scroller, first)?.parentElement?.firstElementChild;
  const firstRow = rowRoot(scroller, first);
  expect(firstRow?.previousElementSibling).toBeNull();

  respond({ items: [makeFeed({ id: feedId, title: 'Late title' })] });
  respond({ items: [] });
  respond({ items: [], boundary: BOUNDARY });
  respond({ count: 0, boundary: BOUNDARY });
  await state.refreshSidebar();
  flush();
  expect(rowRoot(scroller, first)).toBe(firstRow);
  expect(label()?.textContent).toBe('Late title');
  expect(label()?.closest('[data-index]')).toBe(
    rowRoot(scroller, first)?.parentElement
  );
  expect(rowRoot(scroller, second)?.previousElementSibling).toBeNull();
  expect(rowRoot(scroller, first)?.textContent).not.toContain('Late title');
  expect(rowRoot(scroller, second)?.textContent).not.toContain('Late title');
});

it.each(['all', 'folder'] as const)(
  'shows the sidebar feed separator on a skeleton in the %s scope',
  async (kind) => {
    const scope = kind === 'all' ? { kind } : { kind, folderId: uuid(2000) };
    const first = item(uuid(21));
    const second = item(uuid(22));
    const feed = makeFeed({
      id: first.feedId,
      title: 'Sidebar feed',
      siteUrl: 'https://example.com/',
    });
    respond({ items: [feed] });
    respond({ items: [] });
    respond({ items: [], boundary: BOUNDARY });
    respond({ count: 0, boundary: BOUNDARY });
    await state.refreshSidebar();
    respond({
      groups: [{ feedId: feed.id, ids: [first.id, second.id] }],
      boundary: BOUNDARY,
    });
    await state.loadScopeFirstPage(scope, false);
    const batch = Promise.withResolvers<Response>();
    fetchMock.mockReturnValueOnce(batch.promise);

    const scroller = mountList(() => null, scope);
    const wrapper = scroller.querySelector('[data-index="0"]');
    const separator = wrapper?.firstElementChild;
    expect(separator?.textContent).toBe(feed.title);
    expect(separator?.querySelector('img')?.getAttribute('src')).toBe(
      state.feedIconCandidates(feed)[0]
    );
    expect(
      wrapper?.querySelector('[aria-busy="true"] .skeleton')
    ).not.toBeNull();
    expect(scroller.querySelector('[data-index="1"]')?.textContent).toBe('');

    batch.resolve(jsonResponse({ items: [first, second] }));
    await vi.waitFor(() => expect(rowRoot(scroller, first.id)).not.toBeNull());
    expect(wrapper?.firstElementChild).toBe(separator);
    expect(wrapper?.querySelector('[aria-busy="true"]')).toBeNull();
  }
);

it('reserves the combined skeleton and separator height with a coarse-pointer root size', async () => {
  const first = item(uuid(21));
  const second = item(uuid(22));
  const feed = makeFeed({ id: first.feedId, title: 'Sidebar feed' });
  respond({ items: [feed] });
  respond({ items: [] });
  respond({ items: [], boundary: BOUNDARY });
  respond({ count: 0, boundary: BOUNDARY });
  await state.refreshSidebar();
  respond({
    groups: [{ feedId: feed.id, ids: [first.id, second.id] }],
    boundary: BOUNDARY,
  });
  await state.loadScopeFirstPage({ kind: 'all' }, false);
  const pending = Promise.withResolvers<Response>();
  fetchMock.mockReturnValueOnce(pending.promise);
  document.documentElement.style.fontSize = '18px';

  try {
    const scroller = mountList(() => null);
    const group = scroller.querySelector<HTMLElement>('[data-index="0"]');
    const next = scroller.querySelector<HTMLElement>('[data-index="1"]');
    const label = group?.firstElementChild;
    const skeleton = group?.querySelector('[aria-busy="true"]');
    if (
      !(label instanceof HTMLElement) ||
      !(skeleton instanceof HTMLElement) ||
      next === null
    ) {
      throw new Error('missing grouped skeleton');
    }

    const groupHeight =
      Number.parseFloat(label.style.height) +
      Number.parseFloat(skeleton.style.height);
    expect(next.style.transform).toBe(`translateY(${groupHeight}px)`);
    expect(next.parentElement?.style.height).toBe(
      `${groupHeight + Number.parseFloat(skeleton.style.height)}px`
    );
  } finally {
    dispose?.();
    dispose = null;
    document.documentElement.style.removeProperty('font-size');
    pending.resolve(jsonResponse({ items: [first, second] }));
  }
});

it('fetches restored folder rows after a move rolls back', async () => {
  const folderId = uuid(2000);
  const scope = { kind: 'folder', folderId } as const;
  const sibling = item(uuid(21));
  const movedFeed = makeFeed({ id: uuid(1002), folderId });
  const restored = { ...item(uuid(22)), feedId: movedFeed.id };
  respond({
    boundary: BOUNDARY,
    groups: [
      { feedId: sibling.feedId, ids: [sibling.id] },
      { feedId: restored.feedId, ids: [restored.id] },
    ],
  });
  await state.loadScopeFirstPage(scope, false);

  const move = Promise.withResolvers<Response>();
  fetchMock.mockReturnValueOnce(move.promise);
  const moving = state.moveFeedToFolder(movedFeed, null);
  respond({ items: [sibling] });
  const scroller = mountList(() => null, scope);
  await vi.waitFor(() => expect(rowRoot(scroller, sibling.id)).not.toBeNull());
  expect(fetchMock).toHaveBeenCalledTimes(3);

  respond({ items: [restored] });
  move.resolve(jsonResponse({ error: 'RequestFailed' }, 500));
  expect(await moving).toBe(false);

  await vi.waitFor(() => expect(rowRoot(scroller, restored.id)).not.toBeNull());
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(fetchMock.mock.calls[3]?.[0]).toBe(
    `/api/feed-items?ids=${restored.id}`
  );
});

it('preserves the feed row DOM node when extracted content is patched', async () => {
  const article = item(uuid(21));
  respond({
    groups: [{ feedId: article.feedId, ids: [article.id] }],
    boundary: BOUNDARY,
  });
  respond({ items: [article] });
  await state.loadScopeFirstPage({ kind: 'all' }, false);
  const scroller = mountList(() => null);
  await vi.waitFor(() => expect(rowRoot(scroller, article.id)).not.toBeNull());
  const row = rowRoot(scroller, article.id);

  const extractedContent = '<p>Extracted content</p>';
  state.patchArticleLocal(article.id, { extractedContent });
  flush();

  expect(state.articleById(article.id)).toMatchObject({ extractedContent });
  expect(rowRoot(scroller, article.id)).toBe(row);
});

it('shows skeletons until content arrives and keeps keyed rows across read and prepend updates', async () => {
  const scope = { kind: 'later' } as const;
  const page = makePage({ id: uuid(1007) });
  respond({ ids: [page.id], boundary: BOUNDARY });
  await state.loadScopeFirstPage(scope, false);
  const batch = Promise.withResolvers<Response>();
  fetchMock.mockReturnValueOnce(batch.promise);
  const [openId, setOpenId] = createSignal<string | null>(null);
  const scroller = mountList(openId, scope);
  const wrapper = scroller.querySelector('[data-index="0"]');
  expect(wrapper?.querySelector('.skeleton')).not.toBeNull();
  batch.resolve(jsonResponse({ items: [page] }));
  await vi.waitFor(() => expect(rowRoot(scroller, page.id)).not.toBeNull());
  const row = rowRoot(scroller, page.id);
  expect(row?.closest('[data-index]')).toBe(wrapper);
  expect(row?.hasAttribute('data-read')).toBe(false);

  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await state.toggleArticleRead(page.id, true);
  flush();
  expect(rowRoot(scroller, page.id)).toBe(row);
  expect(row?.hasAttribute('data-read')).toBe(true);
  expect(row?.querySelector('button')?.getAttribute('aria-pressed')).toBe(
    'true'
  );

  setOpenId(page.id);
  flush();
  expect(rowRoot(scroller, page.id)).toBe(row);
  expect(row?.querySelector('.bg-neutral')).not.toBeNull();
  expect(row?.hasAttribute('data-read')).toBe(true);

  const newPage = makePage({ id: uuid(1008) });
  state.insertSavedPageLocal(newPage);
  flush();
  expect(rowRoot(scroller, newPage.id)).not.toBeNull();
  expect(rowRoot(scroller, page.id)).toBe(row);
  expect(wrapper?.getAttribute('data-index')).toBe('1');
});
