import type { UiModule } from './state-fixture';

/**
 * Installs view transitions whose DOM updates run only when the test calls `runUpdate` (oldest
 * first, as browsers still run a skipped transition's update), and a visible list registered as
 * the transition target. `advance` lets each update's layout ticks run (fake timers delay a 0 ms
 * timeout queued during a tick by 1 ms).
 */
export const deferViewTransitions = (
  ui: UiModule,
  advance: () => Promise<void>
) => {
  const queued: Array<() => Promise<void>> = [];
  const transition = {
    started: 0,
    /** Runs the oldest pending transition update to completion. */
    runUpdate: async (): Promise<void> => {
      const next = queued.shift();
      if (next === undefined) throw new Error('No pending view transition');
      await next();
    },
  };
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: (update: () => Promise<void>) => {
      transition.started += 1;
      const { promise, resolve } = Promise.withResolvers<void>();
      queued.push(async () => {
        let done = false;
        const running = update().finally(() => {
          done = true;
        });
        while (!done) await advance();
        await running;
        resolve();
      });
      return {
        updateCallbackDone: promise,
        ready: promise,
        finished: promise,
        skipTransition: () => undefined,
      };
    },
  });
  const list = document.createElement('div');
  list.getBoundingClientRect = () =>
    ({
      top: 0,
      left: 0,
      right: 300,
      bottom: 400,
      width: 300,
      height: 400,
    }) as DOMRect;
  const unregister = ui.registerListTransitionTarget(list);

  return {
    transition,
    restore: () => {
      unregister();
      Reflect.deleteProperty(document, 'startViewTransition');
    },
  };
};
