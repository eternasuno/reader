import { expect, it, vi } from 'vitest';
import { createAppHarness, json } from './support/app-harness';

const harness = createAppHarness({ settleTimes: 1 });
const { respond, settle, mountApp } = harness;
harness.installHarnessLifecycle();

type FetchHandler = (url: string, init: RequestInit) => Response | undefined;

const BL_URL = 'https://browserless.example.com';
const BL_API = '/api/settings/services/browserless';
const SAVE = '保存 Browserless 设置';
const CLEAR = '清除 Browserless 设置';
const DELETE_TOKEN = '删除 Token';

const cfg = {
  retention: 50,
  browserless: { url: BL_URL, tokenConfigured: true, residentialProxy: false },
  smtp: { senderEmail: 'a@b', host: 'h', port: 465, security: 'tls' },
  kindle: { kindleEmail: 'k@b', language: 'zh' },
};

const must = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`missing ${selector}`);

  return found;
};

const click = (element: HTMLElement): void => {
  element.click();
  harness.modules.solid.flush();
};

const typeInto = (root: ParentNode, selector: string, value: string): void => {
  const input = must<HTMLInputElement>(root, selector);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  harness.modules.solid.flush();
};

const btn = (root: ParentNode, text: string): HTMLButtonElement => {
  const found = Array.from(root.querySelectorAll('button')).find((el) =>
    el.textContent?.includes(text)
  );
  if (found === undefined) throw new Error(`button ${text} missing`);

  return found;
};

const buttonTexts = (root: ParentNode): Array<string> =>
  Array.from(root.querySelectorAll('button'), (el) =>
    String(el.textContent).trim()
  );

const toastMessage = (): string | undefined =>
  harness.modules.ui.currentToast()?.message;

const mountBrowserless = async (
  body: unknown = cfg,
  override: FetchHandler = () => undefined
) => {
  respond((url, init) => {
    const handled = override(url, init);
    if (handled !== undefined) return handled;
    if (url === '/api/settings') return json(body);
    if (url.includes('sends')) return json({ running: false, items: [] });
  });
  const { container } = mountApp('/settings');
  await settle(4);
  click(must<HTMLButtonElement>(container, 'nav button:nth-of-type(3)'));
  const card = must<HTMLFormElement>(
    container,
    'section[aria-label="外部服务"] form:first-child'
  );

  return { container, card };
};

const recordRequests = (
  method: string,
  prefix: string,
  sink: Array<[string, unknown]>
): FetchHandler => {
  return (url, init) => {
    if (init.method !== method || !url.startsWith(prefix)) return undefined;
    sink.push([
      url,
      typeof init.body === 'string' ? JSON.parse(init.body) : null,
    ]);

    return new Response(null, { status: 204 });
  };
};

it('settings browserless: renders the saved settings as the first services card', async () => {
  const { container, card } = await mountBrowserless();
  const forms = container.querySelectorAll(
    'section[aria-label="外部服务"] form'
  );
  expect(forms[0]).toBe(card);
  expect(card.textContent).toContain('Browserless：已保存');
  expect(card.textContent).toContain(
    '直接抓取失败（如遇到人机验证）时，自动改用 Browserless 抓取。'
  );

  const url = must<HTMLInputElement>(card, 'input[type="url"]');
  expect([url.value, url.required, url.placeholder]).toEqual([
    BL_URL,
    true,
    'https://production-sfo.browserless.io',
  ]);
  const token = must<HTMLInputElement>(card, 'input[type="password"]');
  expect([token.value, token.placeholder, token.autocomplete]).toEqual([
    '',
    '留空则保持已保存的 Token',
    'new-password',
  ]);
  const proxy = must<HTMLInputElement>(card, 'input[type="checkbox"]');
  expect(proxy.checked).toBe(false);
  expect(proxy.classList.contains('toggle')).toBe(true);
  expect(must(card, `label[for="${proxy.id}"]`).textContent).toBe(
    '使用住宅代理'
  );
  expect(card.textContent).toContain(
    '提高通过人机验证的成功率，Browserless 云服务会额外计费。'
  );
  expect(buttonTexts(card)).toEqual([DELETE_TOKEN, CLEAR, SAVE]);
});

it('settings browserless: shows delete-token and clear buttons only when they apply', async () => {
  const none = await mountBrowserless({ ...cfg, browserless: undefined });
  expect(none.card.textContent).toContain('Browserless：未保存');
  expect(must<HTMLInputElement>(none.card, 'input[type="url"]').value).toBe('');
  expect(
    must<HTMLInputElement>(none.card, 'input[type="checkbox"]').checked
  ).toBe(false);
  expect(buttonTexts(none.card)).toEqual([SAVE]);

  const tokenless = await mountBrowserless({
    ...cfg,
    browserless: {
      url: BL_URL,
      tokenConfigured: false,
      residentialProxy: true,
    },
  });
  expect(tokenless.card.textContent).toContain('Browserless：已保存');
  expect(
    must<HTMLInputElement>(tokenless.card, 'input[type="checkbox"]').checked
  ).toBe(true);
  expect(buttonTexts(tokenless.card)).toEqual([CLEAR, SAVE]);
});

it('settings browserless: saves the typed URL, token and proxy flag', async () => {
  const puts: Array<[string, unknown]> = [];
  const { card } = await mountBrowserless(
    { ...cfg, browserless: undefined },
    recordRequests('PUT', BL_API, puts)
  );

  typeInto(card, 'input[type="url"]', BL_URL);
  typeInto(card, 'input[type="password"]', 'bl-secret');
  click(must<HTMLInputElement>(card, 'input[type="checkbox"]'));
  click(btn(card, SAVE));
  await settle(4);

  expect(puts).toEqual([
    [BL_API, { url: BL_URL, token: 'bl-secret', residentialProxy: true }],
  ]);
  expect(must<HTMLInputElement>(card, 'input[type="password"]').value).toBe('');
  expect(must<HTMLInputElement>(card, 'input[type="url"]').value).toBe(BL_URL);
  expect(card.textContent).toContain('Browserless：已保存');
  expect(buttonTexts(card)).toEqual([DELETE_TOKEN, CLEAR, SAVE]);
  expect(toastMessage()).toBe('Browserless 设置已保存');
});

it('settings browserless: omits a blank token so the stored one is kept', async () => {
  const puts: Array<[string, unknown]> = [];
  const { card } = await mountBrowserless(
    cfg,
    recordRequests('PUT', BL_API, puts)
  );

  click(must<HTMLInputElement>(card, 'input[type="checkbox"]'));
  click(btn(card, SAVE));
  await settle(4);

  expect(puts).toEqual([[BL_API, { url: BL_URL, residentialProxy: true }]]);
  expect(buttonTexts(card)).toEqual([DELETE_TOKEN, CLEAR, SAVE]);
});

it('settings browserless: deletes only the token, without confirmation', async () => {
  const confirm = vi.spyOn(window, 'confirm');
  const deletes: Array<[string, unknown]> = [];
  const { card } = await mountBrowserless(
    cfg,
    recordRequests('DELETE', BL_API, deletes)
  );

  click(btn(card, DELETE_TOKEN));
  await settle(4);

  expect(deletes).toEqual([[`${BL_API}/token`, null]]);
  expect(confirm).not.toHaveBeenCalled();
  expect(buttonTexts(card)).toEqual([CLEAR, SAVE]);
  expect(card.textContent).toContain('Browserless：已保存');
  expect(must<HTMLInputElement>(card, 'input[type="url"]').value).toBe(BL_URL);
  expect(toastMessage()).toBe('Browserless Token 已删除');
});

it('settings browserless: clears the settings only after confirmation', async () => {
  const confirm = vi
    .spyOn(window, 'confirm')
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);
  const deletes: Array<[string, unknown]> = [];
  const { card } = await mountBrowserless(
    cfg,
    recordRequests('DELETE', BL_API, deletes)
  );

  click(btn(card, CLEAR));
  await settle(2);
  expect(confirm.mock.calls[0]?.[0]).toContain('清除 Browserless 设置？');
  expect(deletes).toEqual([]);
  expect(card.textContent).toContain('Browserless：已保存');

  click(btn(card, CLEAR));
  await settle(4);
  expect(deletes).toEqual([[BL_API, null]]);
  expect(card.textContent).toContain('Browserless：未保存');
  expect(must<HTMLInputElement>(card, 'input[type="url"]').value).toBe('');
  expect(must<HTMLInputElement>(card, 'input[type="checkbox"]').checked).toBe(
    false
  );
  expect(buttonTexts(card)).toEqual([SAVE]);
  expect(toastMessage()).toBe('Browserless 设置已清除');
});

it('settings browserless: leaving the section discards unsaved edits', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { container, card } = await mountBrowserless();

  typeInto(card, 'input[type="url"]', 'https://other.example.com');
  typeInto(card, 'input[type="password"]', 'typed-secret');
  click(must<HTMLInputElement>(card, 'input[type="checkbox"]'));
  click(must<HTMLButtonElement>(container, 'nav button:nth-of-type(1)'));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(
    must(container, 'nav button[aria-current="page"]').textContent
  ).toContain('文章与订阅');

  click(must<HTMLButtonElement>(container, 'nav button:nth-of-type(3)'));
  expect(must<HTMLInputElement>(card, 'input[type="url"]').value).toBe(BL_URL);
  expect(must<HTMLInputElement>(card, 'input[type="password"]').value).toBe('');
  expect(must<HTMLInputElement>(card, 'input[type="checkbox"]').checked).toBe(
    false
  );
});
