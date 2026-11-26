import { describe, expect, it } from 'vitest';
import { createAppHarness } from './support/app-harness';

const harness = createAppHarness({ settleTimes: 1 });
const { settle, mountApp: mount } = harness;
harness.installHarnessLifecycle();

const mountApp = async (path: string) => {
  const result = mount(path);
  await settle(4);
  return result;
};

const must = <T extends Element>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
};

const click = async (element: HTMLElement): Promise<void> => {
  element.click();
  harness.modules.solid.flush();
  await settle(2);
};

describe('desktop sidebar collapse and expand motion', () => {
  it('keeps sidebar mounted, toggles inert/aria-hidden, and updates grid tracks', async () => {
    const { container } = await mountApp('/all');
    const sidebar = must<HTMLElement>(container, '[data-panel="sidebar"]');
    const grid = sidebar.parentElement;
    if (!grid) throw new Error('missing grid container');

    expect(grid.className).toContain('transition-[grid-template-columns]');
    expect(grid.className).toContain('duration-200');
    expect(grid.className).toContain('md:grid-cols-[15rem_minmax(0,1fr)]');
    expect(sidebar.classList.contains('hidden')).toBe(false);
    expect(sidebar.hasAttribute('inert')).toBe(false);
    expect(sidebar.getAttribute('aria-hidden')).toBeNull();

    await click(must<HTMLButtonElement>(container, '[data-sidebar-collapse]'));
    expect(sidebar.isConnected).toBe(true);
    expect(must(container, '[data-panel="sidebar"]')).toBe(sidebar);
    expect(sidebar.classList.contains('hidden')).toBe(false);
    expect(sidebar.hasAttribute('inert')).toBe(true);
    expect(sidebar.getAttribute('aria-hidden')).toBe('true');
    expect(grid.className).toContain('md:grid-cols-[0rem_minmax(0,1fr)]');

    await click(must<HTMLButtonElement>(container, '[data-sidebar-expand]'));
    expect(sidebar.isConnected).toBe(true);
    expect(sidebar.hasAttribute('inert')).toBe(false);
    expect(sidebar.getAttribute('aria-hidden')).toBeNull();
    expect(grid.className).toContain('md:grid-cols-[15rem_minmax(0,1fr)]');
  });

  it('recovers focus when collapsing while focus is inside the sidebar', async () => {
    const { container } = await mountApp('/all');
    const sidebar = must<HTMLElement>(container, '[data-panel="sidebar"]');
    const listPanel = must<HTMLElement>(container, '[data-panel="list"]');
    sidebar.focus();
    expect(document.activeElement).toBe(sidebar);

    harness.modules.state.toggleSidebarCollapse();
    harness.modules.solid.flush();
    await settle(2);

    expect(sidebar.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(listPanel);
  });
});

const expectClosedDrawer = (
  sidebar: HTMLElement,
  backdrop: HTMLButtonElement
): void => {
  expect(sidebar.classList.contains('max-md:-translate-x-full')).toBe(true);
  expect(sidebar.classList.contains('max-md:invisible')).toBe(true);
  expect(sidebar.classList.contains('max-md:translate-x-0')).toBe(false);
  expect(backdrop.classList.contains('opacity-0')).toBe(true);
  expect(backdrop.classList.contains('pointer-events-none')).toBe(true);
  expect(backdrop.hasAttribute('inert')).toBe(true);
  expect(backdrop.getAttribute('aria-hidden')).toBe('true');
};

const expectOpenDrawer = (
  sidebar: HTMLElement,
  backdrop: HTMLButtonElement
): void => {
  expect(sidebar.classList.contains('max-md:translate-x-0')).toBe(true);
  expect(sidebar.classList.contains('max-md:-translate-x-full')).toBe(false);
  expect(sidebar.classList.contains('max-md:invisible')).toBe(false);
  expect(document.activeElement).toBe(sidebar);
  expect(backdrop.classList.contains('opacity-100')).toBe(true);
  expect(backdrop.classList.contains('pointer-events-none')).toBe(false);
  expect(backdrop.hasAttribute('inert')).toBe(false);
  expect(backdrop.getAttribute('aria-hidden')).toBeNull();
};

describe('narrow-screen drawer and backdrop motion', () => {
  it('keeps drawer and backdrop mounted while closed and flips classes on open/close', async () => {
    const { container } = await mountApp('/all');
    const sidebar = must<HTMLElement>(container, '[data-panel="sidebar"]');
    const backdrop = must<HTMLButtonElement>(
      container,
      'button[aria-label="关闭导航"]'
    );
    const navToggle = must<HTMLButtonElement>(
      container,
      'button[aria-label="切换导航"]'
    );

    expectClosedDrawer(sidebar, backdrop);

    await click(navToggle);
    expectOpenDrawer(sidebar, backdrop);

    await click(backdrop);
    expectClosedDrawer(sidebar, backdrop);
    expect(document.activeElement).toBe(navToggle);
  });
});

describe('narrow-screen drawer when desktop sidebar is collapsed', () => {
  it('clears inert and aria-hidden while the drawer is open', async () => {
    const { container } = await mountApp('/all');
    const sidebar = must<HTMLElement>(container, '[data-panel="sidebar"]');
    const navToggle = must<HTMLButtonElement>(
      container,
      'button[aria-label="切换导航"]'
    );

    await click(must<HTMLButtonElement>(container, '[data-sidebar-collapse]'));
    expect(sidebar.hasAttribute('inert')).toBe(true);

    await click(navToggle);
    expect(sidebar.hasAttribute('inert')).toBe(false);
    expect(sidebar.getAttribute('aria-hidden')).toBeNull();
    expect(document.activeElement).toBe(sidebar);
  });
});
