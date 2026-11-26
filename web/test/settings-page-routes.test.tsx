import { expect, it, vi } from 'vitest';
import { createAppHarness, json } from './support/app-harness';

const harness = createAppHarness({ settleTimes: 1 });
const { respond, settle, mountApp: mount } = harness;
harness.installHarnessLifecycle();
const mountApp = mount;

type FetchHandler = (url: string, init: RequestInit) => Response | undefined;

const requestUrls = (): Array<string> =>
  harness.fetchMock.mock.calls.map((call) => String(call[0]));

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
  harness.modules.solid.flush();
};

const click = (element: HTMLElement): void => {
  element.click();
  harness.modules.solid.flush();
};

const cfg = {
  retention: 50,
  provider: 'direct',
  jinaKeyConfigured: true,
  browserEndpointConfigured: false,
  smtp: { senderEmail: 'a@b', host: 'h', port: 465, security: 'tls' },
  kindle: { kindleEmail: 'k@b' },
};
const SENDS = [
  {
    id: 'send-1',
    startedAt: '2026-11-24T08:00:00Z',
    trigger: 'manual',
    status: 'succeeded',
    articleCount: 3,
    bookCount: 1,
  },
  {
    id: 'send-2',
    startedAt: '2026-11-24T09:00:00Z',
    trigger: 'scheduled',
    status: 'failed',
    articleCount: 0,
    bookCount: 0,
    error: 'smtp: connection refused',
  },
];
const mountSettings = async (
  ov: FetchHandler = () => undefined,
  body: unknown = cfg
) => {
  respond((u, i) => {
    const c = ov(u, i);
    if (c !== undefined) return c;
    if (u === '/api/settings') return json(body);
    if (u.includes('sends')) return json({ running: false, items: SENDS });
  });
  const m = mountApp('/settings');
  await settle(4);
  return m;
};
const sec = (r: ParentNode, l: string) => must(r, `section[aria-label="${l}"]`);
const tab = (r: ParentNode, i: number, l: string) => {
  click(must<HTMLButtonElement>(r, `nav button:nth-of-type(${i + 1})`));
  return sec(r, l);
};
const btn = (r: ParentNode, text: string) => {
  const b = Array.from(r.querySelectorAll('button')).find(
    (el) =>
      el.textContent?.includes(text) || el.getAttribute('aria-label') === text
  );
  if (!b) throw new Error(`button ${text} missing`);
  return b;
};
const radio = (r: ParentNode, v: string) =>
  must<HTMLInputElement>(r, `input[value="${v}"]`);
const confirmPair = () =>
  vi
    .spyOn(window, 'confirm')
    .mockReturnValueOnce(false)
    .mockReturnValueOnce(true);

it('settings: mounts 4 sections, renders Kindle history, and guards edits', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { container, history } = await mountSettings();
  expect(container.textContent).toContain('已发送 3 篇（1 封邮件）');
  expect(container.textContent).toContain('smtp: connection refused');
  expect(inputValue(container, 'input[type="number"]')).toBe('50');
  typeInto(container, 'input[type="number"]', '25');
  tab(container, 1, '提取');
  expect(confirm.mock.calls[0]?.[0]).toContain('当前分区有未保存的修改');
  click(btn(container, '返回阅读器'));
  expect(confirm.mock.calls[1]?.[0]).toContain('有未保存的修改');
  expect(history.get()).toBe('/settings');
});

const labelled = <T extends HTMLElement>(root: ParentNode, text: string): T => {
  const label = Array.from(root.querySelectorAll('label')).find(
    (el) => el.textContent === text
  );
  if (label === undefined) throw new Error(`label ${text} missing`);

  return must<T>(root, `[id="${label.htmlFor}"]`);
};
const optionTexts = (select: HTMLSelectElement): Array<string | null> =>
  Array.from(select.options, (o) => o.textContent);
const choose = (select: HTMLSelectElement, value: string): void => {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  harness.modules.solid.flush();
};
const MINUTE_STEPS = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, '0')
);

const mountKindle = async (ov?: FetchHandler, body?: unknown) => {
  const { container } = await mountSettings(ov, body);
  const kindle = tab(container, 2, 'Kindle');

  return {
    kindle,
    toggle: labelled<HTMLInputElement>(kindle, '每日定时发送'),
    hour: labelled<HTMLSelectElement>(kindle, '小时'),
    minute: labelled<HTMLSelectElement>(kindle, '分钟'),
    zone: labelled<HTMLSelectElement>(kindle, '时区'),
  };
};

it('settings kindle: schedule selects list hours, 5-minute steps and UTC-first zones, disabled while the toggle is off', async () => {
  const { toggle, hour, minute, zone } = await mountKindle();

  expect(toggle.type).toBe('checkbox');
  expect(toggle.checked).toBe(false);
  expect([hour, minute, zone].map((select) => select.disabled)).toEqual([
    true,
    true,
    true,
  ]);
  expect(optionTexts(hour)).toHaveLength(24);
  expect(optionTexts(hour).slice(0, 2)).toEqual(['00', '01']);
  expect(optionTexts(hour).at(-1)).toBe('23');
  expect(optionTexts(minute)).toEqual(MINUTE_STEPS);
  expect(zone.options[0]?.value).toBe('UTC');
  expect(zone.options[0]?.textContent).toBe('UTC (UTC+00:00)');
  const zoneValues = Array.from(zone.options, (o) => o.value);
  expect(new Set(zoneValues).size).toBe(zoneValues.length);
  expect(
    Array.from(zone.options).find((o) => o.value === 'Asia/Shanghai')
      ?.textContent
  ).toBe('Asia/Shanghai (UTC+08:00)');
  expect([hour.value, minute.value, zone.value]).toEqual(['8', '0', 'UTC']);
});

it('settings kindle: toggling enables the selects and saves the timezone inside the schedule', async () => {
  let saved: unknown;
  const { kindle, toggle, hour, minute, zone } = await mountKindle((u, i) => {
    if (u !== '/api/settings/kindle' || i.method !== 'PUT') return undefined;
    saved = JSON.parse(String(i.body));

    return new Response(null, { status: 204 });
  });

  click(toggle);
  expect(toggle.checked).toBe(true);
  expect([hour, minute, zone].map((select) => select.disabled)).toEqual([
    false,
    false,
    false,
  ]);
  choose(hour, '21');
  choose(minute, '45');
  choose(zone, 'Asia/Shanghai');
  click(btn(kindle, '保存 Kindle 设置'));
  await settle(4);

  expect(saved).toEqual({
    kindleEmail: 'k@b',
    schedule: { hour: 21, minute: 45, timezone: 'Asia/Shanghai' },
  });
});

it('settings kindle: shows the saved schedule and keeps an unlisted saved timezone selectable', async () => {
  const { toggle, hour, minute, zone } = await mountKindle(undefined, {
    ...cfg,
    kindle: {
      kindleEmail: 'k@b',
      schedule: { hour: 6, minute: 5, timezone: 'Legacy/Zone' },
      nextSendAt: '2026-11-25T06:05:00Z',
    },
  });

  expect(toggle.checked).toBe(true);
  expect([hour.value, minute.value]).toEqual(['6', '5']);
  expect(hour.disabled).toBe(false);
  expect(zone.value).toBe('Legacy/Zone');
  expect(zone.selectedOptions[0]?.textContent).toBe('Legacy/Zone');
});

it('settings extraction: toggles browser radio by endpoint config and links to services', async () => {
  const confirm = confirmPair();
  const hint = '需先在「外部服务」中配置浏览器服务地址';
  const { container } = await mountSettings();
  const ext = tab(container, 1, '提取');
  expect(radio(ext, 'browser').disabled).toBe(true);
  expect(radio(ext, 'jina').disabled).toBe(false);
  expect(ext.textContent).toContain(hint);
  click(radio(ext, 'jina'));
  click(btn(ext, '前往外部服务'));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(radio(ext, 'jina').checked).toBe(true);
  expect(radio(ext, 'jina').checked).toBe(true);
  click(btn(ext, '前往外部服务'));
  expect(btn(sec(container, '外部服务'), '清除 SMTP 设置')).toBeDefined();
  expect(radio(ext, 'direct').checked).toBe(true);
  const ok = { ...cfg, browserEndpointConfigured: true };
  const next = await mountSettings(undefined, ok);
  const ext2 = tab(next.container, 1, '提取');
  expect(radio(ext2, 'browser').disabled).toBe(false);
  expect(ext2.textContent).not.toContain(hint);
});

it('settings kindle: guards on SMTP, disables send while running, and imports OPML', async () => {
  const run = await mountSettings((u) =>
    u.includes('sends') ? json({ running: true, items: [] }) : undefined
  );
  expect(btn(run.container, '正在发送中…').disabled).toBe(true);
  const ns = await mountSettings(undefined, { ...cfg, smtp: undefined });
  const k = tab(ns.container, 2, 'Kindle');
  expect(must<HTMLFieldSetElement>(k, 'fieldset').disabled).toBe(true);
  expect(k.textContent).toContain('需要先在「外部服务」中配置 SMTP');
  expect(btn(k, '立即发送').disabled).toBe(true);
  click(btn(k, '前往外部服务'));
  expect(sec(ns.container, '外部服务').textContent).toContain('Jina Key');
  const opml = await mountSettings((u, i) =>
    u === '/api/opml' && i.method === 'POST'
      ? json({ importedFeeds: 3, skippedFeeds: 1, createdFolders: 1 })
      : undefined
  );
  const input = must<HTMLInputElement>(opml.container, 'input[type="file"]');
  Object.defineProperty(input, 'files', {
    value: [new File(['<opml/>'], 's.opml')],
  });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await settle(4);
  expect(requestUrls()).toContain('/api/opml');
  expect(harness.modules.ui.currentToast()?.message).toBe(
    '已导入 3 个订阅源，跳过 1 个'
  );
});

it('settings services: renders 3 cards and deletes SMTP only after confirmation', async () => {
  const confirm = confirmPair();
  const url = '/api/settings/services/smtp';
  const { container } = await mountSettings((u, i) =>
    u === url && i.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : undefined
  );
  const svc = tab(container, 3, '外部服务');
  expect(svc.querySelectorAll('form')).toHaveLength(3);
  expect(svc.textContent).toContain('Jina Key：已保存');
  expect(svc.textContent).toContain('浏览器服务地址：未保存');
  expect(svc.textContent).toContain('SMTP：已保存');
  click(btn(svc, '清除 SMTP 设置'));
  await settle(2);
  expect(confirm.mock.calls[0]?.[0]).toContain('清除 SMTP 设置？');
  expect(requestUrls()).not.toContain(url);
  click(btn(svc, '清除 SMTP 设置'));
  await settle(4);
  const del = harness.fetchMock.mock.calls.find(([u]) => u === url);
  expect((del?.[1] as RequestInit | undefined)?.method).toBe('DELETE');
});
