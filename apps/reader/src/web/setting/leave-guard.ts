import { useBeforeLeave } from '@solidjs/router';
import { createEffect, onCleanup } from 'solid-js';
import { browserConfirm, type Confirm } from './confirm';
import { leaveDecision } from './leave';

const isLoginRedirect = (to: unknown): boolean =>
  typeof to === 'string' && to.startsWith('/login');

export type LeaveGuardOptions = {
  readonly saving: () => boolean;
  readonly anyChanged: () => boolean;
  /** The confirmation to ask; the browser's own unless a test passes another. */
  readonly confirm?: Confirm;
};

/**
 * Guards leaving `/settings` (settings.md Saving and unsaved changes): a write in
 * flight blocks the navigation, unsaved changes ask first, the redirect to
 * `/login` when the session ends always goes through, and a changed section raises
 * the browser's own prompt on reload or a closed tab.
 */
export const useLeaveGuard = (options: LeaveGuardOptions) => {
  useBeforeLeave((event) => {
    if (event.defaultPrevented || isLoginRedirect(event.to)) return;

    const decision = leaveDecision({
      saving: options.saving(),
      changed: options.anyChanged(),
      confirm: options.confirm ?? browserConfirm,
    });

    if (decision === 'stay') event.preventDefault();
  });

  createEffect(() => {
    if (!options.anyChanged()) return;

    const prompt = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };

    globalThis.addEventListener('beforeunload', prompt);
    onCleanup(() => globalThis.removeEventListener('beforeunload', prompt));
  });
};
