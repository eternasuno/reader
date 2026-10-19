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
