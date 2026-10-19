import { type Accessor, createEffect, on, onCleanup } from 'solid-js';
import { notifyReaderDataChanged } from '../components/organisms/article-reader-model';

export const useDeferredReaderRefresh = (selection: Accessor<unknown>) => {
  createEffect(
    on(selection, (current, previous) => {
      if (previous && !current) notifyReaderDataChanged();
    })
  );
};

export const useTriggerFocus = (fallback: () => void) => {
  let observer: MutationObserver | undefined;
  const disconnect = () => observer?.disconnect();
  onCleanup(disconnect);
  const watch = (trigger: HTMLElement) => {
    disconnect();
    observer = new MutationObserver(() => {
      if (trigger.isConnected) return;

      disconnect();
      if (document.activeElement === document.body) fallback();
    });
    const list = trigger.closest('.workspace-list');
    if (list) observer.observe(list, { childList: true, subtree: true });
  };

  return { disconnect, watch };
};

const hasOpenDialog = () => document.querySelector('dialog[open]') !== null;

const focusIfVisible = (element: HTMLElement | undefined) => {
  if (!element) return;
  if (!element.isConnected) return;
  if (element.getClientRects().length === 0) return;
  element.focus();
};

export const focusWhenReady = (getTarget: () => HTMLElement | undefined) => {
  queueMicrotask(() => {
    if (hasOpenDialog()) return;

    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      active.getClientRects().length > 0
    )
      return;

    focusIfVisible(getTarget());
  });
};
