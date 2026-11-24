import type { JSX } from '@solidjs/web';
import { render } from '@solidjs/web';
import { flush } from 'solid-js';
import { afterEach, beforeEach, vi } from 'vitest';
import { setLocale } from '../../src/i18n';
import * as state from '../../src/state';
import { dismissToast } from '../../src/ui';

let disposers: Array<() => void> = [];

export const mount = (component: () => JSX.Element): HTMLElement => {
  const container = document.createElement('div');
  document.body.append(container);
  disposers.push(render(component, container));
  flush();
  return container;
};

export const ariaBtn = (
  root: ParentNode,
  label: string
): HTMLButtonElement | null =>
  root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

export const clickAria = (root: ParentNode, label: string): void => {
  ariaBtn(root, label)?.click();
  flush();
};

export const clickButton = (root: ParentNode, text: string): void => {
  const match = Array.from(root.querySelectorAll('button')).find((btn) =>
    btn.textContent?.includes(text)
  );
  match?.click();
  flush();
};

export const setupInteractions = (): void => {
  beforeEach(() => {
    localStorage.clear();
    setLocale('zh-CN');
    state.resetReaderAppearance();
    state.setSidebarCollapsedState(false);
    if (typeof HTMLElement.prototype.showPopover !== 'function') {
      HTMLElement.prototype.showPopover = () => undefined;
    }
  });
  afterEach(() => {
    for (const dispose of disposers) dispose();
    disposers = [];
    document.body.innerHTML = '';
    dismissToast();
    vi.restoreAllMocks();
  });
};
