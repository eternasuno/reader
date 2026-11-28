/**
 * List membership motion: a same-document view transition clipped to the article list, so rows
 * move, enter, and leave instead of jumping. Only rows inside the registered scroll container are
 * captured (`index.css`), and the transition is skipped while that list is scrolling, hidden, or
 * unsupported, in which case the update applies immediately.
 */

const SCROLL_IDLE_MS = 150;
/** Macrotasks that let virtual rows mount, measure, and restore the viewport anchor. */
const LAYOUT_TICKS = 2;
const ACTIVE_ATTRIBUTE = 'data-list-transition';
const CLIP_PROPERTY = '--list-transition-clip';

let target: HTMLElement | null = null;
let lastScrollAt = Number.NEGATIVE_INFINITY;
let updating = false;
let latestTransition = 0;

const markScroll = (): void => {
  lastScrollAt = performance.now();
};

/**
 * Registers the list area whose rows take part in transitions. It stays mounted while the list
 * empties and refills, and observes scrolling of the list inside it (scroll does not bubble).
 */
export const registerListTransitionTarget = (
  element: HTMLElement
): (() => void) => {
  target = element;
  element.addEventListener('scroll', markScroll, {
    capture: true,
    passive: true,
  });

  return () => {
    element.removeEventListener('scroll', markScroll, { capture: true });
    if (target === element) target = null;
  };
};

/** True while a transition's DOM update runs; rows mounted then skip their own entrance. */
export const isListTransitionUpdating = (): boolean => updating;

const visibleRect = (element: HTMLElement | null): DOMRect | null => {
  if (element === null || document.hidden) return null;
  if (typeof document.startViewTransition !== 'function') return null;
  if (performance.now() - lastScrollAt < SCROLL_IDLE_MS) return null;

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
};

const clipTo = (rect: DOMRect): string => {
  const { clientWidth, clientHeight } = document.documentElement;
  return `inset(${rect.top}px ${clientWidth - rect.right}px ${clientHeight - rect.bottom}px ${rect.left}px)`;
};

const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Runs a synchronous list update inside a view transition when possible. `update` runs exactly
 * once either way; callers recheck their own staleness guards inside it, because the transition
 * captures the old state first and only then calls it.
 */
export const runListTransition = async (update: () => void): Promise<void> => {
  const element = target;
  const rect = visibleRect(element);
  if (element === null || rect === null) {
    update();
    return;
  }

  const id = ++latestTransition;
  const root = document.documentElement;
  root.style.setProperty(CLIP_PROPERTY, clipTo(rect));
  element.setAttribute(ACTIVE_ATTRIBUTE, '');

  const transition = document.startViewTransition(async () => {
    updating = true;
    try {
      update();
    } finally {
      updating = false;
    }

    for (let tick = 0; tick < LAYOUT_TICKS; tick += 1) await nextTask();
  });

  // A skipped transition rejects `ready`; the update still ran.
  transition.ready.catch(() => undefined);
  void transition.finished
    .catch(() => undefined)
    .then(() => {
      if (id !== latestTransition) return;

      element.removeAttribute(ACTIVE_ATTRIBUTE);
      root.style.removeProperty(CLIP_PROPERTY);
    });

  await transition.updateCallbackDone;
};
