import { Show } from 'solid-js';
import {
  type DraftStore,
  isSettingsBusy,
  removeJinaKey,
  type SettingsSection,
  type StatusStore,
  submitFetcher,
  submitPassword,
  submitRetention,
} from '../../../models/settings/model';
import {
  busyMessage,
  changePasswordField,
} from '../../../models/settings/section';
import { Button } from '../../atoms/button';
import { AccountSection } from './account-section';
import { ArticlesSection } from './articles-section';
import { ExtractionSection } from './extraction-section';

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
    jinaKeyConfigured={props.drafts.settings()?.jinaKeyConfigured === true}
    browserEndpointConfigured={
      props.drafts.settings()?.browserEndpointConfigured === true
    }
    jinaKey={props.drafts.jinaKey()}
    browserEndpoint={props.drafts.browserEndpoint()}
    onProviderChange={props.drafts.setProvider}
    onJinaKeyChange={props.drafts.setJinaKey}
    onBrowserEndpointChange={props.drafts.setBrowserEndpoint}
    onSubmit={(form) => submitFetcher(props.drafts, props.status, form)}
    onClearKey={() => removeJinaKey(props.drafts, props.status)}
  />
);

export const SettingsPanels = (props: {
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
