import { createEffect } from 'solid-js';

/**
 * Runs `reset` each time a dialog transitions from closed to open, so stale
 * input, errors, and in-flight flags never survive a reopen.
 */
export const createOpenReset = (
  open: () => boolean,
  reset: () => void
): void => {
  createEffect(open, (isOpen) => {
    if (isOpen) reset();
  });
};
