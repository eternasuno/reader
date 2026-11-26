import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppHarness, json } from './support/app-harness';

const harness = createAppHarness();
const { settle } = harness;
harness.installHarnessLifecycle();
let sendsState = { running: false, items: [] as Array<unknown> };

const SETTINGS = {
  retention: 50,
  provider: 'direct',
  jinaKeyConfigured: false,
  browserEndpointConfigured: false,
  smtp: { senderEmail: 'a@b', host: 'h', port: 465, security: 'tls' },
  kindle: { kindleEmail: 'k@b' },
};

const mountSettings = async () => {
  harness.respond((url) => {
    if (url === '/api/settings') return json(SETTINGS);
    if (url === '/api/kindle/sends') return json(sendsState);
  });
  const result = harness.mountApp('/settings');
  await settle(4);
  return result;
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

const setInput = (
  root: ParentNode,
  selector: string,
  value: string,
  index = 0
): void => {
  const el = root.querySelectorAll<HTMLInputElement>(selector)[index];
  if (el === undefined) throw new Error(`missing input ${selector}`);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  harness.modules.solid.flush();
};

const sendsCalls = (): number =>
  harness.fetchMock.mock.calls.filter(
    ([u]) => String(u) === '/api/kindle/sends'
  ).length;

beforeEach(() => {
  sendsState = { running: false, items: [] };
});

it('marks exactly one settings section as current when navigating', async () => {
  const { container } = await mountSettings();
  const names = ['文章与订阅', '提取', 'Kindle', '外部服务'];
  for (const [index, name] of names.entries()) {
    if (index > 0) {
      navBtn(container, index).click();
      await settle();
    }
    const current = container.querySelectorAll(
      'nav button[aria-current="page"]'
    );
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain(name);
    expect(
      container.querySelector(`section[aria-label="${name}"]`)
    ).not.toBeNull();
  }
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
    harness.modules.solid.flush();
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

    setInput(container, 'input[type="number"]', '25');
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

    setInput(container, 'input[type="number"]', '25');

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

describe('settings secret disposal', () => {
  it('disposes secret drafts on exit so secrets never persist across visits', async () => {
    const { container, history } = await mountSettings();
    navBtn(container, 3).click();
    harness.modules.solid.flush();

    const svc = container.querySelector('section[aria-label="外部服务"]');
    if (svc === null) throw new Error('missing services section');
    setInput(svc, 'input[type="password"]', 'jina-secret', 0);
    setInput(svc, 'input[type="url"]', 'http://browser:9222');
    setInput(svc, 'input[type="password"]', 'smtp-secret', 1);

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    container
      .querySelector<HTMLButtonElement>('button[aria-label="返回阅读器"]')
      ?.click();
    await settle(4);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(history.get()).toBe('/later');

    history.set({ value: '/settings' });
    await settle(4);
    navBtn(container, 3).click();
    harness.modules.solid.flush();

    const nextSvc = container.querySelector('section[aria-label="外部服务"]');
    const nextPasswords = nextSvc?.querySelectorAll<HTMLInputElement>(
      'input[type="password"]'
    );
    expect(nextPasswords?.[0]?.value).toBe('');
    expect(
      nextSvc?.querySelector<HTMLInputElement>('input[type="url"]')?.value
    ).toBe('');
    expect(nextPasswords?.[1]?.value).toBe('');

    container
      .querySelector<HTMLButtonElement>('button[aria-label="返回阅读器"]')
      ?.click();
    await settle(4);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(history.get()).toBe('/later');
  });
});

const mountPendingSettings = async (res: Promise<Response>) => {
  harness.respond((url) => {
    if (url === '/api/settings') return res;
    if (url === '/api/kindle/sends') return json(sendsState);
  });
  const { container } = harness.mountApp('/settings');
  await settle(3);
  return container;
};

describe('cold-visit editing gate', () => {
  it('disables settings controls until initial GET completes', async () => {
    let resolveSettings: (r: Response) => void = () => {};
    const container = await mountPendingSettings(
      new Promise<Response>((resolve) => {
        resolveSettings = resolve;
      })
    );

    const retentionInput = container.querySelector<HTMLInputElement>(
      'input[type="number"]'
    );
    const jinaInput = container.querySelector<HTMLInputElement>(
      'section[aria-label="外部服务"] input[type="password"]'
    );
    const radio = container.querySelector<HTMLInputElement>(
      'input[name="extractor-provider"][value="jina"]'
    );
    expect(retentionInput?.disabled).toBe(true);
    expect(findButton(container, '保存文章设置').disabled).toBe(true);
    expect(radio?.disabled).toBe(true);
    expect(findButton(container, '保存提取设置').disabled).toBe(true);
    expect(jinaInput?.disabled).toBe(true);

    resolveSettings(json({ ...SETTINGS, retention: 75 }));
    await settle(3);

    expect(retentionInput?.disabled).toBe(false);
    expect(retentionInput?.value).toBe('75');
    expect(findButton(container, '保存文章设置').disabled).toBe(false);
    expect(radio?.disabled).toBe(false);
    expect(jinaInput?.disabled).toBe(false);
  });

  it('keeps controls disabled when initial GET fails', async () => {
    const container = await mountPendingSettings(
      Promise.resolve(json({ error: 'SettingRepositoryError' }, 500))
    );

    const retentionInput = container.querySelector<HTMLInputElement>(
      'input[type="number"]'
    );
    expect(retentionInput?.disabled).toBe(true);
    expect(findButton(container, '保存文章设置').disabled).toBe(true);
    expect(harness.modules.state.settings()).toBeNull();
  });
});
