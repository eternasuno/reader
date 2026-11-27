import { vi } from 'vitest';
import type {
  Feed,
  FeedItem,
  FeedUnreadCount,
  Folder,
  SavedPage,
  Settings,
} from '../../src/api';

export type StateModule = typeof import('../../src/state');
export type I18nModule = typeof import('../../src/i18n');
export type UiModule = typeof import('../../src/ui');
export type SolidModule = typeof import('solid-js');

export interface SidebarSnapshotOptions {
  feeds?: Array<Feed>;
  folders?: Array<Folder>;
  counts?: Array<FeedUnreadCount>;
  saved?: number;
}

export interface LoadedLibraryOptions {
  scope: Parameters<StateModule['loadScopeFirstPage']>[0];
  items: Array<SavedPage | FeedItem>;
  queuedItems?: Array<SavedPage | FeedItem>;
  unreadOnly?: boolean;
  feeds?: Array<Feed>;
  counts?: Array<FeedUnreadCount>;
  saved?: number;
}

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const noContentResponse = (): Response =>
  new Response(null, { status: 204 });

export const makeKindleSettings = (
  overrides: Partial<Settings> = {}
): Settings => ({
  retention: 100,
  smtp: {
    senderEmail: 'sender@example.com',
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls',
    user: 'smtp-user',
    passwordConfigured: true,
  },
  kindle: {
    kindleEmail: 'kindle@example.com',
    language: 'zh',
    schedule: { hour: 8, minute: 0, timezone: 'Asia/Shanghai' },
    nextSendAt: '2026-11-20T00:00:00Z',
  },
  ...overrides,
});

export const makeFeed = (overrides: Partial<Feed> & { id: string }): Feed => ({
  url: `https://example.com/${overrides.id}/feed.xml`,
  title: `Feed ${overrides.id}`,
  folderId: null,
  failureCount: 0,
  readerMode: 'default',
  order: 'newest',
  ...overrides,
});

export const makeFolder = (id: string, name = `Folder ${id}`): Folder => ({
  id,
  name,
});

export const makePage = (
  overrides: Partial<SavedPage> & { id: string }
): SavedPage => ({
  url: `https://example.com/${overrides.id}`,
  title: `Page ${overrides.id}`,
  content: '<p>content</p>',
  read: false,
  ...overrides,
});

export const makeItem = (
  overrides: Partial<FeedItem> & { id: string; feedId: string }
): FeedItem => ({
  url: `https://example.com/${overrides.id}`,
  title: `Item ${overrides.id}`,
  description: '<p>summary</p>',
  content: '<p>content</p>',
  read: false,
  ...overrides,
});

const createMockHelpers = (getMock: () => ReturnType<typeof vi.fn>) => {
  const queue = (body: unknown, status = 200): void => {
    getMock().mockResolvedValueOnce(jsonResponse(body, status));
  };

  const queueEmpty = (): void => {
    getMock().mockResolvedValueOnce(noContentResponse());
  };

  const pending = (): { resolve: (response: Response) => void } => {
    let resolveFn: (response: Response) => void = () => {};
    const promise = new Promise<Response>((resolve) => {
      resolveFn = resolve;
    });
    getMock().mockImplementationOnce(() => promise);
    return { resolve: resolveFn };
  };

  const queueDeferredResponse = (body: unknown): (() => void) => {
    const slot = pending();
    return () => slot.resolve(jsonResponse(body));
  };

  return { queue, queueEmpty, pending, queueDeferredResponse };
};

const createInspectorHelpers = (getMock: () => ReturnType<typeof vi.fn>) => {
  const requestUrl = (call = 0): string =>
    String(getMock().mock.calls[call]?.[0]);

  const requestInit = (call = 0): RequestInit =>
    (getMock().mock.calls[call]?.[1] ?? {}) as RequestInit;

  const requestBody = (call = 0): unknown => {
    const body = requestInit(call).body;
    return typeof body === 'string' ? JSON.parse(body) : body;
  };

  const fetchCount = (): number => getMock().mock.calls.length;

  return { requestUrl, requestInit, requestBody, fetchCount };
};

export const uuid = (n: number): string =>
  `019363b8-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

const DEFAULT_BOUNDARY = '019363b8-0000-7000-8000-000000000000';

export const savedOrder = (
  items: ReadonlyArray<SavedPage>,
  boundary = DEFAULT_BOUNDARY
) => ({ ids: items.map(({ id }) => id), boundary });

export const feedOrder = (
  items: ReadonlyArray<FeedItem | SavedPage>,
  boundary = DEFAULT_BOUNDARY
) => {
  const idsByFeed = new Map<string, Array<string>>();
  for (const item of items) {
    if (!('feedId' in item)) throw new Error('Expected a feed item');
    const ids = idsByFeed.get(item.feedId) ?? [];
    ids.push(item.id);
    idsByFeed.set(item.feedId, ids);
  }
  return {
    groups: Array.from(idsByFeed, ([feedId, ids]) => ({ feedId, ids })),
    boundary,
  };
};

const sidebarResponses = (options: SidebarSnapshotOptions = {}) => [
  { items: options.feeds ?? [] },
  { items: options.folders ?? [] },
  { items: options.counts ?? [], boundary: DEFAULT_BOUNDARY },
  { count: options.saved ?? 0, boundary: DEFAULT_BOUNDARY },
];

const createSidebarHelpers = (
  mock: ReturnType<typeof createMockHelpers>,
  getModules: () => { state: StateModule; solid: SolidModule }
) => {
  const queueSidebar = (options: SidebarSnapshotOptions = {}): void => {
    for (const body of sidebarResponses(options)) {
      mock.queue(body);
    }
  };

  const queueDeferredSidebar = (
    options: SidebarSnapshotOptions = {}
  ): { resolve: () => void } => {
    const resolvers = sidebarResponses(options).map((body) =>
      mock.queueDeferredResponse(body)
    );
    return {
      resolve: () => {
        for (const resolve of resolvers) resolve();
      },
    };
  };

  const queueLoadedLibrary = async (
    options: LoadedLibraryOptions
  ): Promise<void> => {
    const { state, solid } = getModules();
    if (options.feeds !== undefined) {
      queueSidebar({
        feeds: options.feeds,
        counts: options.counts,
        saved: options.saved,
      });
      await state.refreshSidebar();
      solid.flush();
    }
    const items = [...options.items, ...(options.queuedItems ?? [])];
    mock.queue(
      options.scope.kind === 'later'
        ? savedOrder(items as Array<SavedPage>)
        : feedOrder(items)
    );
    if (items.length > 0) mock.queue({ items: options.items });
    await state.loadScopeFirstPage(options.scope, options.unreadOnly ?? false);
    solid.flush();
  };

  return { queueSidebar, queueDeferredSidebar, queueLoadedLibrary };
};

export const createStateTestContext = () => {
  let fetchMock = vi.fn();
  let state!: StateModule;
  let solid!: SolidModule;
  let i18n!: I18nModule;
  let ui!: UiModule;

  const fresh = async (): Promise<void> => {
    vi.resetModules();
    solid = await import('solid-js');
    i18n = await import('../../src/i18n');
    ui = await import('../../src/ui');
    state = await import('../../src/state');
  };

  const reset = async (): Promise<void> => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.clear();
    await fresh();
  };

  const mock = createMockHelpers(() => fetchMock);
  const inspect = createInspectorHelpers(() => fetchMock);
  const sidebar = createSidebarHelpers(mock, () => ({ state, solid }));

  return {
    get state() {
      return state;
    },
    get solid() {
      return solid;
    },
    get i18n() {
      return i18n;
    },
    get ui() {
      return ui;
    },
    get fetchMock() {
      return fetchMock;
    },
    fresh,
    reset,
    ...mock,
    ...inspect,
    ...sidebar,
  };
};
