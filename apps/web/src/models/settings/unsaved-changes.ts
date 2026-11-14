import { useBeforeLeave } from '@solidjs/router';
import { createEffect, onCleanup } from 'solid-js';
import {
  anySettingsDirty,
  type DraftStore,
  isSettingsBusy,
  type StatusStore,
} from './model';
import { busyMessage } from './section';

const leaveMessage = '有未保存的修改，确定离开设置页吗？';

export const useUnsavedChangesGuard = (
  drafts: DraftStore,
  status: StatusStore
) => {
  createEffect(() => {
    if (!anySettingsDirty(drafts)) return;

    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    onCleanup(() => window.removeEventListener('beforeunload', handler));
  });

  useBeforeLeave((event) => {
    if (event.defaultPrevented) return;

    const authRedirect =
      typeof event.to === 'string' && event.to.startsWith('/login');
    if (isSettingsBusy(status) && !authRedirect) {
      event.preventDefault();
      status.notify('error', busyMessage);

      return;
    }

    if (!anySettingsDirty(drafts)) return;

    event.preventDefault();
    setTimeout(() => {
      if (window.confirm(leaveMessage)) event.retry(true);
    }, 0);
  });
};
