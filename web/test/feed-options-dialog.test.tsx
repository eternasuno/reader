import type { JSX } from '@solidjs/web';
import { render } from '@solidjs/web';
import { createSignal, flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feed } from '../src/api';
import { FeedOptionsDialog } from '../src/components';
import { setLocale } from '../src/i18n';
import { dismissToast } from '../src/ui';

let disposers: Array<() => void> = [];
let fetchMock: ReturnType<typeof vi.fn>;

const mount = (component: () => JSX.Element): HTMLElement => {
  const container = document.createElement('div');
  document.body.append(container);
  disposers.push(render(component, container));
  flush();

  return container;
};

const jsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { status });

const makeFeed = (overrides: Partial<Feed> = {}): Feed => ({
  id: 'f1',
  url: 'https://example.com/rss',
  title: 'Feed',
  folderId: null,
  failureCount: 0,
  readerMode: 'default',
  order: 'newest',
  ...overrides,
});

const selectElement = (): HTMLSelectElement =>
  document.querySelector('#feed-default-display') as HTMLSelectElement;

const changeMode = async (value: Feed['readerMode']): Promise<void> => {
  const select = selectElement();
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  flush();
};

beforeEach(() => {
  localStorage.clear();
  setLocale('zh-CN');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  document.body.innerHTML = '';
  dismissToast();
  vi.restoreAllMocks();
});

describe('FeedOptionsDialog', () => {
  it('renders metadata, hint, and updates feed readerMode', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const feed = makeFeed();
    mount(() => (
      <FeedOptionsDialog open={true} feed={feed} onClose={vi.fn()} />
    ));

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Feed');
    expect(dialog?.textContent).toContain('https://example.com/rss');
    expect(dialog?.textContent).toContain(
      '选择打开此订阅源文章时的默认阅读视图'
    );

    const select = selectElement();
    expect(select.value).toBe('default');
    await changeMode('extracted');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe('/api/feeds/f1/reader-mode');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ readerMode: 'extracted' });
    expect(select.value).toBe('extracted');
    expect(select.disabled).toBe(false);
  });
});

describe('FeedOptionsDialog error & reopen', () => {
  it('reverts selection on failure and resets when reopened', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: 'FeedRepositoryError' }, 500)
    );
    const [open, setOpen] = createSignal(true);
    const [feed, setFeed] = createSignal<Feed | null>(
      makeFeed({ readerMode: 'embedded' })
    );
    mount(() => (
      <FeedOptionsDialog open={open()} feed={feed()} onClose={vi.fn()} />
    ));

    const select = selectElement();
    expect(select.value).toBe('embedded');

    await changeMode('extracted');
    expect(select.value).toBe('embedded');
    expect(select.disabled).toBe(false);

    setOpen(false);
    flush();
    setFeed(makeFeed({ id: 'f2', readerMode: 'extracted' }));
    setOpen(true);
    flush();

    expect(selectElement().value).toBe('extracted');
  });
});
