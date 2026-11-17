import { createEffect, on } from 'solid-js';
import { navOpen } from './nav';
import { openArticleId } from './route';

/**
 * Hiding a panel or the navigation must not lose focus (LIB-VIEW-1, ui.md): when
 * the panel that holds the focused element becomes hidden, focus moves to the
 * panel that took its place. Both are read from the DOM as it actually is, not
 * from a media query, and an open dialog is left alone.
 */

const visible = (element: HTMLElement): boolean =>
  element.getClientRects().length > 0;

const panelOf = (element: Element | null): HTMLElement | undefined => {
  const panel = element?.closest('[data-panel]');

  return panel instanceof HTMLElement ? panel : undefined;
};

const visiblePanel = (): HTMLElement | undefined =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-panel]')).find(
    visible
  );

/** Focuses a hidden panel's place; runs whenever a panel or the nav may hide. */
const keepFocus = (): void => {
  const active = document.activeElement;

  if (active === null || active === document.body) return;
  if (active.closest('dialog') !== null) return;

  const panel = panelOf(active);

  if (panel === undefined || visible(panel)) return;

  visiblePanel()?.focus();
};

/** Called once by the shell, which marks its panels with `data-panel`. */
export const keepPanelFocus = (): void => {
  createEffect(on(() => `${openArticleId() ?? ''}|${navOpen()}`, keepFocus));
};
