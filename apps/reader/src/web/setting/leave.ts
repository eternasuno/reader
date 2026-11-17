import { showToast } from '../ui/toast';
import type { Confirm } from './confirm';
import { settingMessages as copy } from './messages';

export type LeaveDecision = 'leave' | 'stay';

export type LeaveOptions = {
  /** A write is in flight: leaving would lose it. */
  readonly saving: boolean;
  /** Any section differs from what was read. */
  readonly changed: boolean;
  readonly confirm: Confirm;
};

/**
 * Whether the page may be left: a write in flight blocks the navigation and shows
 * the saving status line as an error toast, and unsaved changes ask first
 * (settings.md Saving and unsaved changes). The router's side of it is
 * `leave-guard.ts`.
 */
export const leaveDecision = (options: LeaveOptions): LeaveDecision => {
  if (options.saving) {
    showToast(copy.savingStatus, 'error');

    return 'stay';
  }

  if (!options.changed) return 'leave';

  return options.confirm(copy.leaveConfirmation) ? 'leave' : 'stay';
};
