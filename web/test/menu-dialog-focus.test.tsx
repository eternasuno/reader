import { beforeEach, expect, it } from 'vitest';

beforeEach(() => {
  if (!HTMLElement.prototype.showPopover)
    HTMLElement.prototype.showPopover = () => undefined;
});

import { createAppHarness, json } from './support/app-harness';

const harness = createAppHarness();
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
  const found = [...document.querySelectorAll('button')].find(
    (item) =>
      item.textContent?.trim() === name ||
      item.getAttribute('aria-label') === name
  );
  if (!found) throw new Error(`Missing button ${name}`);
  return found;
};

const openFolderDialog = async (): Promise<HTMLButtonElement> => {
  harness.respond((url) =>
    url === '/api/feeds' ? json({ items: [feed] }) : undefined
  );
  harness.mountApp('/later');
  await harness.settle();
  const row = button('Example feed').parentElement;
  const trigger = row?.querySelector<HTMLButtonElement>(
    'button[aria-label="更多操作"]'
  );
  if (!trigger) throw new Error('Missing menu trigger');
  trigger.focus();
  trigger.click();
  await harness.settle();
  button('移动到').click();
  await harness.settle();
  const item = button('新建目录');
  item.focus();
  item.click();
  await harness.settle();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  return trigger;
};

it('returns focus to the menu trigger after closing the folder dialog', async () => {
  const trigger = await openFolderDialog();
  button('关闭').click();
  await harness.settle();
  expect(document.activeElement).toBe(trigger);
});

it('focuses the main landmark when the menu trigger is removed', async () => {
  const trigger = await openFolderDialog();
  trigger.remove();
  button('关闭').click();
  await harness.settle();
  expect(document.activeElement).toBe(document.querySelector('main'));
});

it('falls back to the main landmark when the menu trigger is not focusable', async () => {
  const trigger = await openFolderDialog();
  trigger.disabled = true;
  button('关闭').click();
  await harness.settle();
  expect(document.activeElement).toBe(document.querySelector('main'));
});
