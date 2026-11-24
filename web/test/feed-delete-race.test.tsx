import { beforeEach, expect, it, vi } from 'vitest';
import { createAppHarness, json } from './support/app-harness';

const harness = createAppHarness();
harness.installHarnessLifecycle();

const feeds = ['A', 'B'].map((name) => ({
  id: name,
  title: `Feed ${name}`,
  url: `https://example.com/${name}`,
  folderId: null,
  failureCount: 0,
  readerMode: 'default',
  order: 'newest',
}));

beforeEach(() => {
  if (!HTMLElement.prototype.showPopover)
    HTMLElement.prototype.showPopover = () => undefined;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

const button = (
  name: string,
  root: ParentNode = document
): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find(
    (item) =>
      item.textContent?.trim() === name ||
      item.getAttribute('aria-label') === name
  );
  if (!found) throw new Error(`Missing button ${name}`);
  return found;
};

const dialog = (): Element => {
  const element = document.querySelector('[role="dialog"]');
  if (!element) throw new Error('Missing dialog');

  return element;
};

const setup = async (path: string) => {
  let resolveDelete!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    resolveDelete = resolve;
  });
  harness.respond((url, init) => {
    if (url === '/api/feeds/A' && init.method === 'DELETE') return pending;
    if (url === '/api/feeds') return json({ items: feeds });
  });
  const app = harness.mountApp(path);
  await harness.settle();
  return { ...app, resolveDelete };
};

const openOptions = async (name: string): Promise<void> => {
  const row = button(`Feed ${name}`).parentElement;
  if (!row) throw new Error('Missing feed row');
  button('更多操作', row).click();
  await harness.settle();
  button('订阅源选项…').click();
  await harness.settle();
};

it('keeps the new feed drawer open when an earlier delete completes', async () => {
  const { resolveDelete } = await setup('/later');
  await openOptions('A');
  button('退订', dialog()).click();
  await harness.settle();
  button('关闭', dialog()).click();
  await harness.settle();
  await openOptions('B');
  resolveDelete(new Response(null, { status: 204 }));
  await harness.settle();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    'Feed B'
  );
});

it('preserves a changed unread filter when a pending delete navigates', async () => {
  const { resolveDelete, history } = await setup('/feed/A');
  await openOptions('A');
  button('退订', dialog()).click();
  await harness.settle();
  button('关闭', dialog()).click();
  await harness.settle();
  button('只显示未读').click();
  await harness.settle();
  resolveDelete(new Response(null, { status: 204 }));
  await harness.settle();
  expect(history.get()).toBe('/all?unread');
});
