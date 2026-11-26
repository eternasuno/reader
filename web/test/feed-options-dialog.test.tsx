import { createSignal, flush } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feed } from '../src/api';
import { FeedOptionsDialog } from '../src/components';
import { mount, setupInteractions } from './support/list-helpers';

setupInteractions();
let fetchMock: ReturnType<typeof vi.fn>;

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
  document.querySelector('[role="dialog"] select') as HTMLSelectElement;

const changeMode = async (value: Feed['readerMode']): Promise<void> => {
  const select = selectElement();
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  flush();
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
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

const rowValues = (label: string): Array<string> =>
  Array.from(document.querySelectorAll('[role="dialog"] span'))
    .filter((span) => span.textContent === label)
    .map((span) => span.parentElement?.textContent?.replace(label, '') ?? '');

describe('FeedOptionsDialog website and icon', () => {
  it('shows siteUrl in the website row and its favicon, not the feed URL host', () => {
    const feed = makeFeed({
      url: 'https://rsshub.example/twitter/user/alice',
      siteUrl: 'https://twitter.example/alice',
    });
    mount(() => (
      <FeedOptionsDialog open={true} feed={feed} onClose={vi.fn()} />
    ));

    expect(rowValues('网站')).toEqual(['https://twitter.example/alice']);
    expect(rowValues('RSS')).toEqual([feed.url]);
    expect(
      document.querySelector('[role="dialog"] img')?.getAttribute('src')
    ).toBe('https://twitter.example/favicon.ico');
  });

  it('hides the website row and falls back to the RSS glyph without siteUrl', () => {
    const feed = makeFeed({ url: 'https://rsshub.example/blog/bob' });
    mount(() => (
      <FeedOptionsDialog open={true} feed={feed} onClose={vi.fn()} />
    ));

    const dialog = document.querySelector('[role="dialog"]');
    expect(rowValues('网站')).toEqual([]);
    expect(rowValues('RSS')).toEqual([feed.url]);
    expect(dialog?.querySelector('img')).toBeNull();
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

describe('FeedOptionsDialog accessibility and focus', () => {
  it('focuses the select on open, closes on Escape, and returns focus', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open options';
    document.body.append(trigger);
    trigger.focus();

    const [open, setOpen] = createSignal(false);
    mount(() => (
      <FeedOptionsDialog
        open={open()}
        feed={makeFeed()}
        onClose={() => setOpen(false)}
      />
    ));

    setOpen(true);
    flush();
    await Promise.resolve();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(selectElement());

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
    flush();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
