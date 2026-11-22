import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadHarness = async () => {
  vi.resetModules();

  return {
    solid: await import('solid-js'),
    web: await import('@solidjs/web'),
    router: await import('@solidjs/router'),
    state: await import('../src/state'),
    i18n: await import('../src/i18n'),
    ui: await import('../src/ui'),
    routes: await import('../src/routes'),
    app: await import('../src/App'),
  };
};

type Harness = Awaited<ReturnType<typeof loadHarness>>;

let h: Harness;
let fetchMock: ReturnType<typeof vi.fn>;
let disposers: Array<() => void> = [];
let sendsState = { running: false, items: [] as Array<unknown> };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

const SETTINGS = {
  retention: 50,
  provider: 'direct',
  jinaKeyConfigured: false,
  browserEndpointConfigured: false,
  smtp: { senderEmail: 'a@b', host: 'h', port: 465, security: 'tls' },
  kindle: { kindleEmail: 'k@b', sendTime: '' },
};

const settle = async (times = 3): Promise<void> => {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.solid.flush();
  }
};

const mountSettings = async () => {
  fetchMock.mockImplementation((input: unknown) => {
    const url = String(input);
    if (url.includes('/api/auth/session')) return json({ authenticated: true });
    if (url === '/api/settings') return json(SETTINGS);
    if (url === '/api/kindle/sends') return json(sendsState);

    return json({ items: [], cursor: null, item: null });
  });

  const history = h.router.memoryHistory('/settings');
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
  await settle(4);

  return { container, history };
};

const navBtn = (root: ParentNode, index: number): HTMLButtonElement => {
  const btn = root.querySelector<HTMLButtonElement>(
    `nav button:nth-of-type(${index + 1})`
  );
  if (btn === null) throw new Error(`missing nav button ${index}`);

  return btn;
};

const findButton = (root: ParentNode, text: string): HTMLButtonElement => {
  const btn = Array.from(
    root.querySelectorAll<HTMLButtonElement>('button')
  ).find((el) => el.textContent?.includes(text));
  if (btn === undefined) throw new Error(`missing button ${text}`);

  return btn;
};

const sendsCalls = (): number =>
  fetchMock.mock.calls.filter(([u]) => String(u) === '/api/kindle/sends')
    .length;

beforeEach(async () => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  sendsState = { running: false, items: [] };
  h = await loadHarness();
  h.i18n.setLocale('zh-CN');
});

afterEach(() => {
  for (const dispose of disposers) dispose();
  disposers = [];
  h?.ui.dismissToast();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('kindle history refresh on section entry', () => {
  it('refreshes sends once on entering Kindle and re-enables send when finished', async () => {
    sendsState = { running: true, items: [] };
    const { container } = await mountSettings();
    const initialCalls = sendsCalls();

    navBtn(container, 2).click();
    await settle(3);
    expect(sendsCalls()).toBe(initialCalls + 1);
    expect(findButton(container, '正在发送中…').disabled).toBe(true);

    navBtn(container, 0).click();
    h.solid.flush();
    expect(sendsCalls()).toBe(initialCalls + 1);

    sendsState = { running: false, items: [] };
    navBtn(container, 2).click();
    await settle(3);

    expect(sendsCalls()).toBe(initialCalls + 2);
    expect(findButton(container, '立即发送').disabled).toBe(false);
  });

  it('does not fetch sends when switching into Kindle is cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { container } = await mountSettings();
    const initialCalls = sendsCalls();

    h.state.setRetentionDraft(25);
    h.solid.flush();
    navBtn(container, 2).click();
    await settle(2);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(sendsCalls()).toBe(initialCalls);
  });
});

describe('settings leave guards', () => {
  it('guards beforeunload only while dirty and cleans up on unmount', async () => {
    const { container, history } = await mountSettings();
    const cleanEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    h.state.setRetentionDraft(25);
    h.solid.flush();

    const dirtyEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    container
      .querySelector<HTMLButtonElement>('button[aria-label="返回阅读器"]')
      ?.click();
    await settle(4);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(history.get()).toBe('/later');

    const afterLeaveEvent = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(afterLeaveEvent);
    expect(afterLeaveEvent.defaultPrevented).toBe(false);
  });
});
