import { useNavigate } from '@solidjs/router';
import { createEffect, Show } from 'solid-js';
import { authClient } from '../api/auth';
import { SettingsNav } from '../components/organisms/settings/nav';
import { SettingsPanels } from '../components/organisms/settings/panels';
import { SettingsToast } from '../components/organisms/settings/toast';
import { SettingsLayout } from '../components/templates/settings-layout';
import { isSettingsBusy, useSettingsModel } from '../models/settings/model';
import { useSettingsSection } from '../models/settings/section';
import { useUnsavedChangesGuard } from '../models/settings/unsaved-changes';

const SettingsView = () => {
  const { drafts, status, reload } = useSettingsModel();
  const { active, pick, navigationRef, contentRef } = useSettingsSection(
    drafts,
    status
  );
  useUnsavedChangesGuard(drafts, status);

  return (
    <SettingsLayout
      contentRef={contentRef}
      nav={
        <SettingsNav
          active={active()}
          busy={isSettingsBusy(status)}
          onPick={pick}
          navRef={navigationRef}
        />
      }
      panels={
        <SettingsPanels
          drafts={drafts}
          status={status}
          section={active()}
          onReload={reload}
        />
      }
      toast={
        <SettingsToast
          toast={status.toast()}
          onDismiss={() => status.setToast(undefined)}
        />
      }
    />
  );
};

const SettingsGate = () => {
  const navigate = useNavigate();
  const session = authClient.useSession();

  createEffect(() => {
    const current = session();
    if (!current.isPending && !current.data && !current.error) {
      navigate('/login', { replace: true });
    }
  });

  return (
    <Show
      when={!session().isPending}
      fallback={
        <p class="grid min-h-dvh place-items-center text-sm">
          正在确认登录状态…
        </p>
      }
    >
      <Show
        when={!session().error}
        fallback={
          <p
            role="alert"
            class="grid min-h-dvh place-items-center text-sm text-error"
          >
            暂时无法确认登录状态，请刷新重试。
          </p>
        }
      >
        <Show when={session().data?.user.id} keyed>
          {(_userId) => <SettingsView />}
        </Show>
      </Show>
    </Show>
  );
};

export default SettingsGate;
