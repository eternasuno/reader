import type { SettingsSection } from '../../../models/settings/model';
import { busyMessage } from '../../../models/settings/section';
import { NavButton } from '../../atoms/nav-item';

export const SettingsNav = (props: {
  readonly active: SettingsSection;
  readonly busy: boolean;
  readonly onPick: (section: SettingsSection) => void;
  readonly navRef: (element: HTMLElement) => void;
}) => (
  <nav
    ref={props.navRef}
    aria-label="设置分区"
    aria-busy={props.busy ? 'true' : 'false'}
    class="flex flex-col gap-1 lg:sticky lg:top-8"
  >
    <NavButton
      active={props.active === 'account'}
      class="w-full justify-start"
      aria-controls="settings-account"
      disabled={props.busy}
      title={props.busy ? busyMessage : undefined}
      onClick={() => props.onPick('account')}
    >
      账号
    </NavButton>
    <NavButton
      active={props.active === 'articles'}
      class="w-full justify-start"
      aria-controls="settings-articles"
      disabled={props.busy}
      title={props.busy ? busyMessage : undefined}
      onClick={() => props.onPick('articles')}
    >
      文章
    </NavButton>
    <NavButton
      active={props.active === 'extraction'}
      class="w-full justify-start"
      aria-controls="settings-extraction"
      disabled={props.busy}
      title={props.busy ? busyMessage : undefined}
      onClick={() => props.onPick('extraction')}
    >
      提取
    </NavButton>
  </nav>
);
