import { createSignal } from 'solid-js';
import {
  type DraftStore,
  isSectionDirty,
  isSettingsBusy,
  resetSettingsSection,
  type SettingsSection,
  type StatusStore,
} from './model';

export const busyMessage = '正在保存设置，完成前无法切换分区或离开本页。';

const discardMessage = '当前分区有未保存的修改，切换后将被丢弃。确定继续吗？';

const sectionId = (section: SettingsSection) => `settings-${section}`;

export type PasswordField = 'current' | 'next' | 'confirm';

export const changePasswordField = (
  drafts: DraftStore,
  field: PasswordField,
  value: string
) => {
  if (field === 'current') drafts.setCurrentPassword(value);
  else if (field === 'next') drafts.setNewPassword(value);
  else drafts.setConfirmPassword(value);
};

export const useSettingsSection = (drafts: DraftStore, status: StatusStore) => {
  const [active, setActive] = createSignal<SettingsSection>('account');
  let navigation: HTMLElement | undefined;
  let content: HTMLDivElement | undefined;

  const sidebarLayout = () => {
    if (navigation === undefined || content === undefined) return false;

    const nav = navigation.getBoundingClientRect();
    const body = content.getBoundingClientRect();

    return nav.width > 0 && body.width > 0 && nav.right <= body.left + 1;
  };

  const pick = (target: SettingsSection) => {
    if (target === active()) return;

    if (isSettingsBusy(status)) return;

    if (!sidebarLayout()) {
      setActive(target);
      document
        .getElementById(sectionId(target))
        ?.scrollIntoView({ block: 'start' });

      return;
    }

    const current = active();
    if (isSectionDirty(drafts, current) && !window.confirm(discardMessage)) {
      return;
    }

    resetSettingsSection(drafts, current);
    setActive(target);
  };

  return {
    active,
    pick,
    navigationRef: (element: HTMLElement) => {
      navigation = element;
    },
    contentRef: (element: HTMLDivElement) => {
      content = element;
    },
  };
};
