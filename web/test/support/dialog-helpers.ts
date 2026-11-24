import { type JSX, render } from '@solidjs/web';
import { flush } from 'solid-js';
import { afterEach, beforeEach, vi } from 'vitest';
import type { Feed, Folder, SavedPage } from '../../src/api';
import {
  AddLinkDialog,
  FolderNameDialog,
  type FolderNameDialogProps,
  SubscribeFeedDialog,
} from '../../src/components';
import { setLocale } from '../../src/i18n';
import { dismissToast } from '../../src/ui';

export const POST_URL = 'https://example.com/post';
export const FEED_URL = 'https://example.com/feed.xml';

export let fetchMock: ReturnType<typeof vi.fn>;
const disposers: Array<() => void> = [];

export const jsonResponse = (body: unknown, status = 200): Response =>
  Response.json(body, { status });

export const mount = (component: () => JSX.Element): void => {
  const container = document.createElement('div');
  document.body.append(container);
  disposers.push(render(component, container));
  flush();
};

export const reset = (): void => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.innerHTML = '';
  fetchMock.mockClear();
};

export const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0)).then(() => flush());

export const text = (): string => document.body.textContent ?? '';

export const element = <T extends Element>(selector: string): T =>
  document.querySelector(selector) as T;

export const typeInto = (value: string, selector = 'input'): void => {
  const input = element<HTMLInputElement>(selector);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flush();
};

export const submitAndSettle = async (): Promise<void> => {
  element<HTMLFormElement>('form').dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true })
  );
  flush();
  await settle();
};

export const selectOption = (value: string): void => {
  const select = element<HTMLSelectElement>('select');
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  flush();
};

export const urlOf = (call: number): string =>
  String(fetchMock.mock.calls[call]?.[0] ?? '');
export const bodyOf = (call: number): unknown =>
  JSON.parse(String(fetchMock.mock.calls[call]?.[1]?.body ?? 'null'));
export const textsOf = (selector: string): Array<string | null> =>
  Array.from(document.querySelectorAll(selector)).map(
    (item) => item.textContent
  );

export const savedPage = (overrides: Partial<SavedPage> = {}): SavedPage => ({
  id: 'page-1',
  url: POST_URL,
  title: 'Post',
  content: 'Body',
  read: false,
  ...overrides,
});
export const feed = (overrides: Partial<Feed> = {}): Feed => ({
  id: 'feed-1',
  url: FEED_URL,
  title: 'Go Blog',
  folderId: null,
  failureCount: 0,
  readerMode: 'default',
  order: 'newest',
  ...overrides,
});
export const folder = (id: string, name: string): Folder => ({ id, name });

export const FOLDERS = [folder('folder-1', 'Tech'), folder('folder-2', 'News')];
export const PREVIEW = {
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

export const addLink = (url: string, responses: ReadonlyArray<Response>) =>
  runDialog(AddLinkDialog, { open: true }, url, responses);

export const subscribe = (
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

export const folderName = (
  mode: FolderNameDialogProps['mode'],
  name: string,
  extra: Partial<FolderNameDialogProps>,
  responses: ReadonlyArray<Response>
) =>
  runDialog(FolderNameDialog, { open: true, mode, ...extra }, name, responses);
