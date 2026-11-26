import { render } from '@solidjs/web';
import { createSignal, flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem } from '../src/api';
import { ArticleListBody } from '../src/components/ArticleListBody';
import * as state from '../src/state';
import { prependRow } from '../src/state/library-store';
import { installResizeObserver, sizeScroller } from './support/virtual-helpers';

let dispose: (() => void) | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

const BOUNDARY = '019363b8-0000-7000-8000-000000000000';

const item = (id: string): FeedItem => ({
  id,
  feedId: 'f1',
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

const mountList = (openId: () => string | null): HTMLDivElement => {
  const notifyResize = installResizeObserver();
  const container = document.createElement('div');
  document.body.append(container);
  dispose = render(
    () => (
      <ArticleListBody
        ids={state.rowIds()}
        scope={{ kind: 'all' }}
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

describe('article list row DOM stability', () => {
  it('keeps one row node per article across read, content, paging, and prepend updates', async () => {
    respond({
      items: [item('i1'), item('i2')],
      cursor: 'c1',
      boundary: BOUNDARY,
    });
    await state.loadScopeFirstPage({ kind: 'all' }, false);
    const [openId, setOpenId] = createSignal<string | null>(null);
    const scroller = mountList(openId);
    const row = rowRoot(scroller, 'i1');
    expect(row).not.toBeNull();
    expect(row?.hasAttribute('data-read')).toBe(false);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await state.toggleArticleRead('i1', true);
    flush();
    expect(rowRoot(scroller, 'i1')).toBe(row);
    expect(row?.hasAttribute('data-read')).toBe(true);
    expect(row?.querySelector('button')?.getAttribute('aria-pressed')).toBe(
      'true'
    );

    state.patchArticleLocal('i1', { extractedContent: '<p>full</p>' });
    flush();
    expect(rowRoot(scroller, 'i1')).toBe(row);

    respond({ items: [item('i3')], cursor: null, boundary: BOUNDARY });
    await state.loadNextPage();
    flush();
    expect(rowRoot(scroller, 'i3')).not.toBeNull();
    expect(rowRoot(scroller, 'i1')).toBe(row);

    prependRow({ kind: 'feed', ...item('i0') });
    flush();
    expect(rowRoot(scroller, 'i0')).not.toBeNull();
    expect(rowRoot(scroller, 'i1')).toBe(row);
    expect(row?.closest('[data-index]')?.getAttribute('data-index')).toBe('1');

    setOpenId('i1');
    flush();
    expect(rowRoot(scroller, 'i1')).toBe(row);
    expect(row?.querySelector('.bg-neutral')).not.toBeNull();
    expect(row?.hasAttribute('data-read')).toBe(true);
  });
});
