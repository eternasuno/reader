import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FetchHandler = (url: string, init: RequestInit) => Response | undefined;

const load = async () => {
  vi.resetModules();
  return {
    solid: await import('solid-js'),
    web: await import('@solidjs/web'),
    router: await import('@solidjs/router'),
    api: await import('../src/api'),
    state: await import('../src/state'),
    i18n: await import('../src/i18n'),
    ui: await import('../src/ui'),
    routes: await import('../src/routes'),
    app: await import('../src/App'),
  };
};

type Harness = Awaited<ReturnType<typeof load>>;

let h: Harness;
let fetchMock: ReturnType<typeof vi.fn>;
let disposers: Array<() => void> = [];

const SAVE_PATH = '/save?url=https%3A%2F%2Fexample.com%2Fpost';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const respond = (handler: FetchHandler = () => undefined): void => {
  fetchMock.mockImplementation((input: unknown, init: unknown) => {
    const url = String(input);
    const custom = handler(url, (init ?? {}) as RequestInit);

    return Promise.resolve(custom ?? json(defaultBody(url)));
  });
};

/** Default bodies keep every background loader quiet unless a test overrides them. */
const defaultBody = (url: string): unknown => {
  if (url.includes('/api/auth/session')) return { authenticated: true };

  return { items: [], cursor: null, item: null };
};

const requestUrls = (): Array<string> =>
  fetchMock.mock.calls.map((call) => String(call[0]));

const hasUrl = (prefix: string): boolean =>
  requestUrls().some((url) => url.startsWith(prefix));

/** `later.md:54-58`: the confirmation form performs exactly one mutating request. */
const posts = (): ReadonlyArray<unknown> =>
  fetchMock.mock.calls.filter(
    (call) => (call[1] as RequestInit | undefined)?.method === 'POST'
  );

const settle = async (times = 1): Promise<void> => {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.solid.flush();
  }
};

const mountApp = (path: string) => {
  const history = h.router.memoryHistory(path);
  const router = h.routes.createAppRouter(history);
  const container = document.createElement('div');
  document.body.append(container);
  disposers.push(
    h.web.render(
      () => h.solid.createComponent(h.app.App, { router }),
      container
    )
  );
  h.solid.flush();

  return { container, history };
};

const must = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`missing ${selector}`);

  return found;
};

const inputValue = (root: ParentNode, selector: string): string =>
  must<HTMLInputElement>(root, selector).value;

const typeInto = (root: ParentNode, selector: string, value: string): void => {
  const input = must<HTMLInputElement>(root, selector);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  h.solid.flush();
};

const submitForm = (root: ParentNode): void => {
  const form = must<HTMLFormElement>(root, 'form');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  h.solid.flush();
};

const click = (element: HTMLElement): void => {
  element.click();
  h.solid.flush();
};

const savedPage = () => ({
  id: 'page-1',
  url: 'https://example.com/post',
  title: 'Post',
  content: 'Body',
  read: false,
});

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  respond();
  h = await load();
  h.i18n.setLocale('zh-CN');
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  h?.ui.dismissToast();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('quick save page', () => {
  it('never mutates on GET and posts once from the focused form', async () => {
    respond((url, init) =>
      url === '/api/saved-pages' && init.method === 'POST'
        ? json({ item: savedPage() }, 201)
        : undefined
    );

    const { container, history } = mountApp(SAVE_PATH);
    await settle(4);

    expect(posts()).toHaveLength(0);
    expect(inputValue(container, 'input[type="url"]')).toBe(
      'https://example.com/post'
    );
    expect(document.activeElement).toBe(
      must(container, 'button[type="submit"]')
    );

    submitForm(container);
    await settle(4);

    expect(posts()).toHaveLength(1);
    expect(history.get()).toBe('/later/page-1');
  });

  it('opens the existing page when the URL is already saved', async () => {
    respond((url, init) => {
      if (url === '/api/saved-pages' && init.method === 'POST')
        return json({ error: 'SavedPageAlreadyExists' }, 409);
      if (url.startsWith('/api/saved-pages/lookup'))
        return json({ item: savedPage() });

      return undefined;
    });

    const { container, history } = mountApp(SAVE_PATH);
    await settle(4);
    submitForm(container);
    await settle(4);

    expect(hasUrl('/api/saved-pages/lookup?url=')).toBe(true);
    expect(history.get()).toBe('/later/page-1');
  });
});

describe('quick save errors', () => {
  it('shows a translated error inline so the URL can be fixed', async () => {
    respond((url, init) =>
      url === '/api/saved-pages' && init.method === 'POST'
        ? json({ error: 'InvalidPageUrl' }, 400)
        : undefined
    );

    const { container, history } = mountApp('/save?url=not-a-url');
    await settle(4);

    typeInto(container, 'input[type="url"]', 'ftp://example.com/post');
    submitForm(container);
    await settle(4);

    expect(container.textContent).toContain('请输入有效的 http 或 https 链接');
    expect(history.get()).toBe('/save?url=not-a-url');
  });
});

/** Saved settings body plus the Kindle history the page renders under the form. */
const settingsBody = {
  retention: 50,
  provider: 'direct',
  jinaKeyConfigured: true,
  browserEndpointConfigured: false,
  kindle: {
    smtpSecurity: 'tls',
    sendTime: '',
    smtpPasswordConfigured: true,
  },
};

const SEND_RECORDS = [
  { trigger: 'manual', status: 'succeeded', articleCount: 3, bookCount: 1 },
  { trigger: 'scheduled', status: 'failed', error: 'smtp: connection refused' },
];

const respondSettings = (overrides: FetchHandler = () => undefined): void => {
  respond((url, init) => {
    const custom = overrides(url, init);
    if (custom !== undefined) return custom;
    if (url === '/api/settings') return json(settingsBody);
    if (!url.includes('/api/kindle/sends')) return undefined;

    return json({ running: false, items: SEND_RECORDS });
  });
};

const sectionClass = (root: ParentNode, label: string): string =>
  must(root, `section[aria-label="${label}"]`).className;

const navButton = (root: ParentNode, index: number): void => {
  must<HTMLButtonElement>(root, `nav button:nth-of-type(${index + 1})`).click();
  h.solid.flush();
};

const buttonWithText = (root: ParentNode, text: string): HTMLButtonElement => {
  const button = Array.from(
    root.querySelectorAll<HTMLButtonElement>('button')
  ).find((element) => element.textContent?.includes(text));
  if (button === undefined) throw new Error(`button ${text} missing`);

  return button;
};

describe('settings rendering', () => {
  it('keeps all three sections mounted and renders the Kindle history', async () => {
    respondSettings();
    const { container } = mountApp('/settings');
    await settle(4);

    expect(container.textContent).toContain(
      'Jina Key：已保存 · 浏览器服务地址：未保存'
    );
    expect(container.textContent).toContain('已发送 3 篇（1 封邮件）');
    expect(container.textContent).toContain(
      '发送失败：smtp: connection refused'
    );
    expect(inputValue(container, 'input[type="number"]')).toBe('50');
    expect(sectionClass(container, '文章与订阅')).toContain('block');
    expect(sectionClass(container, '提取')).toContain('hidden');

    const sendTime = Array.from(container.querySelectorAll('select')).find(
      (select) => select.options[0]?.value === ''
    );
    const slots = Array.from(sendTime?.options ?? [], (option) => option.value);
    expect(slots).toHaveLength(49);
    expect(slots.slice(0, 4)).toEqual(['', '00:00', '00:30', '01:00']);
    expect(slots.at(-1)).toBe('23:30');
  });
});

describe('settings providers', () => {
  it('reveals the Jina key input only for the Jina provider', async () => {
    respondSettings();
    const { container } = mountApp('/settings');
    await settle(4);
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(
      1
    );

    navButton(container, 1);
    await settle(4);
    expect(sectionClass(container, '提取')).toContain('block');
    expect(sectionClass(container, '文章与订阅')).toContain('hidden');

    const radios = container.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]'
    );
    const jina = Array.from(radios).find((radio) => radio.value === 'jina');
    jina?.click();
    await settle(4);

    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(
      2
    );
    expect(container.textContent).toContain('Jina API Key（可选）');
    expect(container.textContent).toContain('删除 Key');
  });
});

describe('settings guards', () => {
  it('confirms before discarding unsaved changes', async () => {
    respondSettings();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { container, history } = mountApp('/settings');
    await settle(4);

    typeInto(container, 'input[type="number"]', '25');
    navButton(container, 1);
    expect(confirm).toHaveBeenCalledWith(
      '当前分区有未保存的修改，切换后将被丢弃。确定继续吗？'
    );
    expect(sectionClass(container, '文章与订阅')).toContain('block');

    click(buttonWithText(container, '返回阅读器'));
    expect(confirm).toHaveBeenCalledWith('有未保存的修改，确定离开设置页吗？');
    expect(history.get()).toBe('/settings');
  });
});

describe('settings kindle', () => {
  it('disables 立即发送 while a Kindle send is running', async () => {
    respondSettings((url) =>
      url.includes('/api/kindle/sends')
        ? json({ running: true, items: [] })
        : undefined
    );
    const { container } = mountApp('/settings');
    await settle(4);

    expect(buttonWithText(container, '正在发送中…').disabled).toBe(true);
  });

  it('imports OPML from the articles section and reports the summary', async () => {
    respondSettings((url, init) =>
      url === '/api/opml' && init.method === 'POST'
        ? json({ importedFeeds: 3, skippedFeeds: 1, createdFolders: 1 })
        : undefined
    );
    const { container } = mountApp('/settings');
    await settle(4);

    const fileInput = must<HTMLInputElement>(container, 'input[type="file"]');
    const file = new File(['<opml/>'], 'subs.opml', { type: 'text/xml' });
    Object.defineProperty(fileInput, 'files', { value: [file] });
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(4);

    expect(requestUrls()).toContain('/api/opml');
    expect(h.ui.currentToast()?.message).toBe('已导入 3 个订阅源，跳过 1 个');
  });
});
