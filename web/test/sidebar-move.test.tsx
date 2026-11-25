import { expect, it } from 'vitest';
import { createAppHarness, json } from './support/app-harness';

const harness = createAppHarness({ settleTimes: 1 });
const { settle } = harness;
harness.installHarnessLifecycle();

const feed = {
  id: 'feed-1',
  title: 'Example feed',
  url: 'https://example.com/feed',
  folderId: null,
  failureCount: 0,
  readerMode: 'default',
  order: 'newest',
};
const button = (name: string): HTMLButtonElement => {
  const found = Array.from(document.querySelectorAll('button')).find(
    (item) =>
      item.textContent?.trim() === name ||
      item.getAttribute('aria-label') === name
  );
  if (!found) throw new Error(`Missing button ${name}`);
  return found;
};

it('moves a feed to a newly created folder', async () => {
  harness.respond((url, init) => {
    if (url === '/api/feeds') return json({ items: [feed] });
    if (url === '/api/folders' && init.method === 'POST')
      return json({ item: { id: 'new-folder', name: 'New folder' } }, 201);
    if (url === '/api/feeds/feed-1' && init.method === 'PATCH')
      return new Response(null, { status: 204 });
  });
  harness.mountApp('/later');
  await settle();
  await settle();
  const row = button('Example feed').parentElement;
  const menu = row?.querySelector<HTMLButtonElement>(
    'button[aria-label="更多操作"]'
  );
  expect(menu).toBeTruthy();
  menu?.click();
  harness.modules.solid.flush();
  button('移动到').click();
  harness.modules.solid.flush();
  button('新建目录').click();
  harness.modules.solid.flush();
  const input = document.querySelector<HTMLInputElement>(
    '[role="dialog"] input'
  );
  expect(input).toBeTruthy();
  if (!input) throw new Error('Missing folder input');
  input.value = 'New folder';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  harness.modules.solid.flush();
  input.form?.dispatchEvent(
    new Event('submit', { bubbles: true, cancelable: true })
  );
  await settle();
  await settle();
  const move = harness.fetchMock.mock.calls.find(
    ([url, init]) =>
      String(url) === '/api/feeds/feed-1' && init?.method === 'PATCH'
  );
  expect(move).toBeDefined();
  expect(JSON.parse(String(move?.[1]?.body))).toEqual({
    folderId: 'new-folder',
  });
});
