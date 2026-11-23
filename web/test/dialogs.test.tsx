import { type JSX, render } from '@solidjs/web';
import { flush } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Feed, Folder, SavedPage } from '../src/api';
import {
  AddLinkDialog,
  FolderNameDialog,
  type FolderNameDialogProps,
  SubscribeFeedDialog,
} from '../src/components';
import { setLocale } from '../src/i18n';
import { currentToast, dismissToast } from '../src/ui';

const POST_URL = 'https://example.com/post';
const FEED_URL = 'https://example.com/feed.xml';

let fetchMock: ReturnType<typeof vi.fn>;
const disposers: Array<() => void> = [];

const jsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { status });

const mount = (component: () => JSX.Element): void => {
  const container = document.createElement('div');
  document.body.append(container);
  disposers.push(render(component, container));
  flush();
};

const reset = (): void => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.innerHTML = '';
  fetchMock.mockClear();
};

const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0)).then(() => flush());

const text = (): string => document.body.textContent ?? '';

const element = <T extends Element>(selector: string): T =>
  document.querySelector(selector) as T;

const typeInto = (value: string, selector = 'input'): void => {
  const input = element<HTMLInputElement>(selector);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flush();
};

const submitAndSettle = async (): Promise<void> => {
  element<HTMLFormElement>('form').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true })
  );
  flush();
  await settle();
};

const selectOption = (value: string): void => {
  const select = element<HTMLSelectElement>('select');
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  flush();
};

const urlOf = (call: number): string =>
  String(fetchMock.mock.calls[call]?.[0] ?? '');
const bodyOf = (call: number): unknown =>
  JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body ?? 'null'));
const textsOf = (selector: string): Array<string | null> =>
  Array.from(document.querySelectorAll(selector)).map(
    (item) => item.textContent
  );

const savedPage = (overrides: Partial<SavedPage> = {}): SavedPage => ({
  id: 'page-1',
  url: POST_URL,
  title: 'Post',
  content: 'Body',
  read: false,
  ...overrides,
});
const feed = (overrides: Partial<Feed> = {}): Feed => ({
  id: 'feed-1',
  url: FEED_URL,
  title: 'Go Blog',
  folderId: null,
  failureCount: 0,
  readerMode: 'default',
  order: 'newest',
  ...overrides,
});
const folder = (id: string, name: string): Folder => ({ id, name });

const FOLDERS = [folder('folder-1', 'Tech'), folder('folder-2', 'News')];
const PREVIEW = {
  url: FEED_URL,
  title: 'Go Blog',
  description: 'Weekly Go links',
  titles: ['First post', 'Second post', 'Third post', 'Fourth post'],
};

const mockHandlers = () => ({
  onClose: vi.fn<() => void>(),
  onSaved: vi.fn<(value?: unknown) => void>(),
  onDuplicateFound: vi.fn<(value?: unknown) => void>(),
  onSubscribed: vi.fn<(value?: unknown) => void>(),
  onMove: vi.fn<(target: unknown, folderId: unknown) => Promise<void>>(),
});

type Handlers = ReturnType<typeof mockHandlers>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  dismissToast();
  setLocale('zh-CN');
});

afterEach(() => {
  reset();
  dismissToast();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const runDialog = async <P extends object>(
  Dialog: (props: P) => JSX.Element,
  props: Omit<P, keyof Handlers>,
  input: string | undefined,
  responses: ReadonlyArray<Response>
) => {
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  const handlers = mockHandlers();
  mount(() => Dialog({ ...props, ...handlers } as P));
  if (input !== undefined) {
    typeInto(input);
    await submitAndSettle();
  }

  const out = {
    ...handlers,
    firstUrl: urlOf(0),
    firstBody: bodyOf(0),
    lastUrl: () => urlOf(fetchMock.mock.calls.length - 1),
  };

  return out;
};

const addLink = (url: string, responses: ReadonlyArray<Response>) =>
  runDialog(AddLinkDialog, { open: true }, url, responses);

const subscribe = (
  url: string,
  feeds: ReadonlyArray<Feed>,
  responses: ReadonlyArray<Response>
) =>
  runDialog(
    SubscribeFeedDialog,
    { open: true, folders: FOLDERS, existingFeeds: feeds },
    url,
    responses
  );

const folderName = (
  mode: FolderNameDialogProps['mode'],
  name: string,
  extra: Partial<FolderNameDialogProps>,
  responses: ReadonlyArray<Response>
) =>
  runDialog(FolderNameDialog, { open: true, mode, ...extra }, name, responses);

describe('AddLinkDialog', () => {
  it('creates saved pages and reports duplicates inline', async () => {
    const created = savedPage({ id: 'created' });
    const out = await addLink(`  ${POST_URL}  `, [
      jsonResponse({ item: created }, 201),
    ]);

    expect(out.firstUrl).toBe('/api/saved-pages');
    expect(out.firstBody).toEqual({ url: POST_URL });
    expect(out.onSaved).toHaveBeenCalledWith(created);

    reset();
    dismissToast();
    const existing = savedPage({ id: 'existing' });
    const found = await addLink(POST_URL, [
      jsonResponse({ error: 'SavedPageAlreadyExists', id: 'existing' }, 409),
      jsonResponse({ item: existing }),
    ]);

    expect(urlOf(1)).toBe('/api/saved-pages/existing');
    expect(found.onDuplicateFound).toHaveBeenCalledWith(existing);
    expect(currentToast()).toBeNull();

    reset();
    await addLink(POST_URL, [
      jsonResponse({ error: 'SavedPageAlreadyExists' }, 409),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(text()).toContain('该文章已在稍后阅读中');
  });
});

describe('SubscribeFeedDialog preview', () => {
  it('previews the feed, then subscribes into the chosen folder', async () => {
    const subscribed = feed({ folderId: 'folder-2' });
    const out = await subscribe(
      `  ${FEED_URL}  `,
      [],
      [
        jsonResponse({ preview: PREVIEW }),
        jsonResponse({ item: subscribed }, 201),
      ]
    );

    expect(out.firstUrl).toBe('/api/feeds/preview');
    expect(textsOf('option')).toEqual(['不放入目录', 'Tech', 'News']);

    selectOption('folder-2');
    await submitAndSettle();

    expect(bodyOf(1)).toMatchObject({ title: 'Go Blog', folderId: 'folder-2' });
    expect(out.onSubscribed).toHaveBeenCalledWith(subscribed);
  });

  it('subscribes without a folder and keeps private-feed credentials', async () => {
    await subscribe(
      FEED_URL,
      [],
      [jsonResponse({ preview: PREVIEW }), jsonResponse({ item: feed() }, 201)]
    );
    await submitAndSettle();

    expect(bodyOf(1)).toMatchObject({ folderId: null });

    reset();
    await subscribe(
      'https://user:secret@example.com/feed.xml',
      [],
      [jsonResponse({ preview: PREVIEW }), jsonResponse({ item: feed() }, 201)]
    );

    expect(text()).toContain(FEED_URL);
    expect(bodyOf(0)).toMatchObject({
      url: 'https://user:secret@example.com/feed.xml',
    });
  });
});

describe('SubscribeFeedDialog duplicates', () => {
  it('reuses a known duplicate and reloads for unknown ones', async () => {
    const existing = feed({ id: 'existing' });
    const known = await subscribe(
      FEED_URL,
      [existing],
      [
        jsonResponse({ preview: PREVIEW }),
        jsonResponse({ error: 'FeedAlreadyExists' }, 409),
      ]
    );
    await submitAndSettle();

    expect(known.onDuplicateFound).toHaveBeenCalledWith(existing);
    expect(currentToast()).toMatchObject({ message: '该订阅已存在' });

    reset();
    const unknown = await subscribe(
      FEED_URL,
      [],
      [
        jsonResponse({ preview: PREVIEW }),
        jsonResponse({ error: 'FeedAlreadyExists' }, 409),
        jsonResponse({
          items: [feed({ id: 'other', url: 'https://b.example/f' })],
        }),
      ]
    );
    await submitAndSettle();

    expect(unknown.lastUrl()).toBe('/api/feeds');
    expect(unknown.onDuplicateFound).not.toHaveBeenCalled();
  });
});

describe('FolderNameDialog', () => {
  it('creates a folder with the trimmed name and rejects empty ones', async () => {
    const created = folder('folder-1', 'Tech');
    const out = await folderName('create', '  Tech  ', {}, [
      jsonResponse({ item: created }, 201),
    ]);

    expect(out.firstUrl).toBe('/api/folders');
    expect(out.firstBody).toEqual({ name: 'Tech' });

    reset();
    await folderName('create', '   ', {}, []);

    expect(text()).toContain('请输入目录名称');
  });

  it('renames a folder without a folder payload', async () => {
    const out = await folderName(
      'rename',
      'Tech Blog',
      { initialName: 'Tech', folderId: 'folder-1' },
      [new Response(null, { status: 204 })]
    );

    expect(out.firstUrl).toBe('/api/folders/folder-1');
    expect(out.firstBody).toEqual({ name: 'Tech Blog' });
  });
});
