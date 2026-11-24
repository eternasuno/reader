import type { RouteState } from '../state';

/** Panels collected by the library layout; focus recovery reads them after route changes. */
export interface PanelElements {
  sidebar?: HTMLElement;
  list?: HTMLElement;
  reader?: HTMLElement;
}

/**
 * `LIB-VIEW-1`: panels are hidden by CSS. `offsetParent` catches a hidden ancestor; the computed
 * `display`/`visibility` walk covers elements without a layout box (e.g. jsdom, `position: fixed`).
 */
const isElementVisible = (element: HTMLElement): boolean => {
  if (element.offsetParent !== null) return true;
  if (
    typeof window === 'undefined' ||
    typeof window.getComputedStyle !== 'function'
  )
    return false;

  let node: HTMLElement | null = element;
  while (node !== null) {
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    node = node.parentElement;
  }

  return true;
};

const panelOf = (element: HTMLElement): HTMLElement | null => {
  let node: HTMLElement | null = element;
  while (node !== null) {
    if (node.dataset.panel !== undefined) return node;
    node = node.parentElement;
  }

  return null;
};

const firstVisible = (
  elements: ReadonlyArray<HTMLElement | undefined>
): HTMLElement | undefined =>
  elements.find(
    (element) => element !== undefined && isElementVisible(element)
  );

/** `LIB-VIEW-1`: never strand keyboard focus inside a panel that CSS just hid. */
export const recoverFocus = (
  state: RouteState | null,
  panels: PanelElements
): void => {
  if (typeof document === 'undefined' || state === null) return;

  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;

  const current = panelOf(active);
  if (current === null || isElementVisible(current)) return;

  const preferred = state.articleId === null ? panels.list : panels.reader;
  firstVisible([preferred, panels.list, panels.sidebar])?.focus({
    preventScroll: true,
  });
};
