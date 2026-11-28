import { flush } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ArticleListBody } from '../src/components/ArticleListBody';
import * as state from '../src/state';
import { mountLiveList } from '../src/state/library-live';
import { mountSidebarRefresh } from '../src/state/sidebar-refresh';
import { mount, setupInteractions } from './support/list-helpers';
import {
  jsonResponse,
  makePage,
  savedOrder,
  uuid,
} from './support/state-fixture';
import { installResizeObserver } from './support/virtual-helpers';

const scope = { kind: 'later' } as const;
const boundary = uuid(2000);
const liveBoundary = uuid(2001);
const rowHeight = 136;

setupInteractions();

afterEach(() => {
  state.clearSidebarState();
  state.clearLibraryState();
  vi.unstubAllGlobals();
});

const mountScrolledList = (): HTMLDivElement => {
  const notifyResize = installResizeObserver();
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(
    rowHeight
  );
  const host = mount(() => (
    <ArticleListBody
      ids={state.rowIds()}
      scope={scope}
      unreadOnly={false}
      openArticleId={null}
      onNavigate={vi.fn()}
    />
  ));
  const scroller = host.querySelector<HTMLDivElement>('.overflow-y-auto');
  if (scroller === null) throw new Error('missing scroller');

  Object.defineProperties(scroller, {
    clientHeight: { value: 150 },
    scrollHeight: { get: () => state.rowIds().length * rowHeight },
    scrollTo: {
      value: ({ top }: ScrollToOptions) => {
        scroller.scrollTop = top ?? 0;
        // Deliver the browser's programmatic scroll event on the next rendering update.
        requestAnimationFrame(() =>
          scroller.dispatchEvent(new Event('scroll'))
        );
      },
    },
  });
  notifyResize(scroller, 150);
  scroller.scrollTop = 20 * rowHeight;
  scroller.dispatchEvent(new Event('scroll'));
  flush();

  return scroller;
};

const mockListResponses = () => {
  const initial = Array.from({ length: 60 }, (_, index) =>
    makePage({ id: uuid(100 - index) })
  );
  const added = Array.from({ length: 60 }, (_, index) =>
    makePage({ id: uuid(160 - index) })
  );
  const pages = new Map([...added, ...initial].map((page) => [page.id, page]));
  const contentRequests: Array<Array<string>> = [];
  let order = savedOrder(initial, boundary);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const [path, search] = url.split('?');
      if (path === '/api/saved-pages/order') return jsonResponse(order);

      const ids = new URLSearchParams(search).get('ids')?.split(',');
      if (ids !== undefined) {
        contentRequests.push(ids);
        return jsonResponse({ items: ids.map((id) => pages.get(id)) });
      }

      return jsonResponse({ items: [], count: 0, boundary });
    })
  );

  return {
    anchor: initial[20],
    firstInserted: added[0],
    contentRequests,
    insertPages: () => {
      contentRequests.length = 0;
      order = savedOrder([...added, ...initial], liveBoundary);
    },
  };
};

it('refreshes the anchored window first after a live insertion above the viewport', async () => {
  const { anchor, firstInserted, contentRequests, insertPages } =
    mockListResponses();
  await state.loadScopeFirstPage(scope, false);
  const scroller = mountScrolledList();
  await vi.waitFor(() => expect(state.articleById(anchor.id)).toBeDefined());
  const untrack = state.trackLibraryMount();
  const stopPolling = mountSidebarRefresh();
  const stopLive = mountLiveList();
  try {
    insertPages();
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(contentRequests.length).toBeGreaterThan(0));

    expect(state.listBoundary()).toBe(liveBoundary);
    expect(contentRequests[0]).toContain(anchor.id);
    expect(contentRequests[0]).not.toContain(firstInserted.id);
    expect(scroller.scrollTop).toBe(80 * rowHeight);
  } finally {
    stopLive();
    stopPolling();
    untrack();
  }
});
