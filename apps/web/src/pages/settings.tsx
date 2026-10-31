import { useBeforeLeave, useNavigate } from '@solidjs/router';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { Button } from '../components/atoms/button';
import { NavButton } from '../components/atoms/nav-item';
import { AccountSection } from '../components/organisms/settings-account-section';
import { ArticlesSection } from '../components/organisms/settings-articles-section';
import { ExtractionSection } from '../components/organisms/settings-extraction-section';
import { SettingsToast } from '../components/organisms/settings-toast';
import { authClient } from '../lib/auth';
import {
  anySettingsDirty,
  type DraftStore,
  isSectionDirty,
  isSettingsBusy,
  removeBrowserEndpoint,
  removeJinaKey,
  resetSettingsSection,
  type SettingsSection,
  type StatusStore,
  submitExtraction,
  submitPassword,
  submitRetention,
  useSettingsModel,
} from './settings-model';

const discardMessage = '当前分区有未保存的修改，切换后将被丢弃。确定继续吗？';
const leaveMessage = '有未保存的修改，确定离开设置页吗？';
const busyMessage = '正在保存设置，完成前无法切换分区或离开本页。';

const sectionId = (section: SettingsSection) => `settings-${section}`;

type PasswordField = 'current' | 'next' | 'confirm';

const changePasswordField = (
  drafts: DraftStore,
  field: PasswordField,
  value: string
) => {
  if (field === 'current') drafts.setCurrentPassword(value);
  else if (field === 'next') drafts.setNewPassword(value);
  else drafts.setConfirmPassword(value);
};

const useSettingsSection = (drafts: DraftStore, status: StatusStore) => {
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

const useUnsavedChangesGuard = (drafts: DraftStore, status: StatusStore) => {
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

const SettingsNav = (props: {
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

const AccountPanel = (props: {
  readonly drafts: DraftStore;
  readonly status: StatusStore;
  readonly visible: boolean;
}) => (
  <AccountSection
    class={props.visible ? '' : 'lg:hidden'}
    busy={isSettingsBusy(props.status)}
    pending={props.status.pending() === 'password'}
    currentPassword={props.drafts.currentPassword()}
    newPassword={props.drafts.newPassword()}
    confirmPassword={props.drafts.confirmPassword()}
    onChange={(field, value) => changePasswordField(props.drafts, field, value)}
    onSubmit={(form) => submitPassword(props.drafts, props.status, form)}
  />
);

const ArticlesPanel = (props: {
  readonly drafts: DraftStore;
  readonly status: StatusStore;
  readonly visible: boolean;
}) => (
  <ArticlesSection
    class={props.visible ? '' : 'lg:hidden'}
    busy={isSettingsBusy(props.status)}
    pending={props.status.pending() === 'retention'}
    retention={props.drafts.retention()}
    onChange={props.drafts.setRetention}
    onSubmit={(form) => submitRetention(props.drafts, props.status, form)}
  />
);

const ExtractionPanel = (props: {
  readonly drafts: DraftStore;
  readonly status: StatusStore;
  readonly visible: boolean;
}) => (
  <ExtractionSection
    class={props.visible ? '' : 'lg:hidden'}
    busy={isSettingsBusy(props.status)}
    pending={props.status.pending() === 'extraction'}
    provider={props.drafts.provider()}
    jinaConfigured={props.drafts.settings()?.jinaConfigured === true}
    jinaKey={props.drafts.jinaKey()}
    browserEndpoint={props.drafts.browserEndpoint()}
    browserConfigured={(props.drafts.settings()?.browserEndpoint ?? '') !== ''}
    onProviderChange={props.drafts.setProvider}
    onJinaKeyChange={props.drafts.setJinaKey}
    onBrowserEndpointChange={props.drafts.setBrowserEndpoint}
    onSubmit={(form) => submitExtraction(props.drafts, props.status, form)}
    onClearKey={() => removeJinaKey(props.drafts, props.status)}
    onClearBrowser={() => removeBrowserEndpoint(props.drafts, props.status)}
  />
);

const SettingsPanels = (props: {
  readonly drafts: DraftStore;
  readonly status: StatusStore;
  readonly section: SettingsSection;
  readonly onReload: () => void;
}) => (
  <div class="flex min-w-0 flex-col gap-6">
    <Show when={isSettingsBusy(props.status)}>
      <p
        role="status"
        aria-live="polite"
        class="rounded-box border border-base-300 bg-base-100 px-4 py-3 text-sm text-base-content/70"
      >
        {busyMessage}
      </p>
    </Show>
    <Show when={props.status.loadError()}>
      {(message) => (
        <div class="alert alert-error" role="alert">
          <span class="text-sm">{message()}</span>
          <Button class="btn btn-sm" type="button" onClick={props.onReload}>
            重试
          </Button>
        </div>
      )}
    </Show>
    <Show when={props.status.loading()}>
      <p class="text-sm text-base-content/60" role="status">
        正在读取设置…
      </p>
    </Show>
    <Show
      when={!props.status.loading() && props.drafts.settings() !== undefined}
    >
      <AccountPanel
        drafts={props.drafts}
        status={props.status}
        visible={props.section === 'account'}
      />
      <ArticlesPanel
        drafts={props.drafts}
        status={props.status}
        visible={props.section === 'articles'}
      />
      <ExtractionPanel
        drafts={props.drafts}
        status={props.status}
        visible={props.section === 'extraction'}
      />
    </Show>
  </div>
);

const SettingsView = () => {
  const { drafts, status, reload } = useSettingsModel();
  const { active, pick, navigationRef, contentRef } = useSettingsSection(
    drafts,
    status
  );
  useUnsavedChangesGuard(drafts, status);

  return (
    <main class="min-h-dvh bg-base-200 text-base-content">
      <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-10 lg:p-8">
        <header class="flex items-start justify-between gap-3 lg:col-span-2">
          <div>
            <h1 class="text-2xl font-semibold tracking-tight">设置</h1>
            <p class="mt-1 text-sm text-base-content/60">
              管理账号、文章保留与正文提取。
            </p>
          </div>
          <a href="/" class="link shrink-0 text-sm">
            返回阅读
          </a>
        </header>
        <SettingsNav
          active={active()}
          busy={isSettingsBusy(status)}
          onPick={pick}
          navRef={navigationRef}
        />
        <div ref={contentRef} class="flex min-w-0 flex-col gap-6">
          <SettingsPanels
            drafts={drafts}
            status={status}
            section={active()}
            onReload={reload}
          />
        </div>
      </div>
      <SettingsToast
        toast={status.toast()}
        onDismiss={() => status.setToast(undefined)}
      />
    </main>
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
