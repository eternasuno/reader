import { createSignal, flush } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Dialog } from '../src/ui/Dialog';
import { Menu, MenuItem } from '../src/ui/Menu';
import { rememberMenuTrigger, takeMenuTrigger } from '../src/ui/menu-focus';
import { mount, setupInteractions } from './support/list-helpers';

setupInteractions();

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  takeMenuTrigger();
  vi.useRealTimers();
});

const runPendingTimers = (): void => {
  vi.runAllTimers();
  flush();
};

const openMenuAndClick = async (
  menuLabel: string,
  itemText: string
): Promise<HTMLButtonElement> => {
  const trigger = document.querySelector<HTMLButtonElement>(
    `button[aria-label="${menuLabel}"]`
  );
  if (!trigger) throw new Error(`Missing menu trigger ${menuLabel}`);
  trigger.focus();
  trigger.click();
  flush();
  const panel = document.querySelector<HTMLElement>('[role="menu"]');
  if (panel) panel.style.display = 'block';
  await Promise.resolve();
  const item = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
  ).find((el) => el.textContent?.includes(itemText));
  if (!item) throw new Error(`Missing menu item ${itemText}`);
  expect(document.activeElement).toBe(item);
  item.click();
  flush();
  return trigger;
};

const closeDialog = async (): Promise<void> => {
  const closeBtn = document.querySelector<HTMLButtonElement>(
    'button[aria-label="关闭"]'
  );
  if (!closeBtn) throw new Error('Missing dialog close button');
  closeBtn.click();
  flush();
  await Promise.resolve();
};

const setup = (opensDialog: boolean) => {
  const trigger = document.createElement('button');
  const item = document.createElement('button');
  item.setAttribute('role', 'menuitem');
  if (opensDialog) item.dataset.opensDialog = 'true';
  document.body.append(trigger, item);
  const event = new MouseEvent('click', { bubbles: true });
  Object.defineProperty(event, 'target', { value: item });
  rememberMenuTrigger(event, { trigger });
  return trigger;
};

it('records the opener only for items that open a dialog', () => {
  const trigger = setup(true);
  expect(takeMenuTrigger()).toBe(trigger);
  expect(takeMenuTrigger()).toBeUndefined();
});

it('does not record a trigger for actions that open no dialog', () => {
  setup(false);
  expect(takeMenuTrigger()).toBeUndefined();
});

it('expires a recorded opener that no dialog consumed', async () => {
  setup(true);
  runPendingTimers();
  expect(takeMenuTrigger()).toBeUndefined();
});

it('falls back to main when a marked item opens its dialog after a macrotask', async () => {
  const [open, setOpen] = createSignal(false);
  mount(() => (
    <>
      <main>
        <Menu label="操作">
          <MenuItem
            opensDialog
            onSelect={() => {
              setTimeout(() => {
                setOpen(true);
                flush();
              }, 0);
            }}
          >
            异步弹窗
          </MenuItem>
        </Menu>
      </main>
      <Dialog
        open={open()}
        title="弹窗"
        closeLabel="关闭"
        onClose={() => setOpen(false)}
      >
        <p>内容</p>
      </Dialog>
    </>
  ));

  const trigger = await openMenuAndClick('操作', '异步弹窗');
  runPendingTimers();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();

  await closeDialog();
  const main = document.querySelector('main');
  expect(document.activeElement).not.toBe(trigger);
  expect(document.activeElement).toBe(main);
});

it('does not leak an unconsumed record from a non-dialog action to a later unrelated dialog', async () => {
  const [open, setOpen] = createSignal(false);
  mount(() => (
    <>
      <main>
        <Menu label="操作">
          <MenuItem opensDialog onSelect={() => undefined}>
            未弹窗操作
          </MenuItem>
        </Menu>
        <button
          type="button"
          id="unrelated-opener"
          onClick={() => setOpen(true)}
        >
          打开无关弹窗
        </button>
      </main>
      <Dialog
        open={open()}
        title="弹窗"
        closeLabel="关闭"
        onClose={() => setOpen(false)}
      >
        <p>内容</p>
      </Dialog>
    </>
  ));

  const oldTrigger = await openMenuAndClick('操作', '未弹窗操作');
  runPendingTimers();

  const unrelatedOpener =
    document.querySelector<HTMLButtonElement>('#unrelated-opener');
  if (!unrelatedOpener) throw new Error('Missing unrelated opener');
  unrelatedOpener.focus();
  unrelatedOpener.click();
  flush();
  await Promise.resolve();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();

  await closeDialog();
  expect(document.activeElement).toBe(unrelatedOpener);
  expect(document.activeElement).not.toBe(oldTrigger);

  await openMenuAndClick('操作', '未弹窗操作');
  runPendingTimers();

  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
  setOpen(true);
  flush();
  await Promise.resolve();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();

  await closeDialog();
  expect(document.activeElement).toBe(document.querySelector('main'));
  expect(document.activeElement).not.toBe(oldTrigger);
});
