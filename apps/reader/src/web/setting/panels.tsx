import { Show } from 'solid-js';
import { Button } from '../ui/button';
import { AccountSection } from './account-section';
import { FetcherSection } from './fetcher-section';
import { KindleSection } from './kindle/kindle-section';
import { type SettingsLayout, sectionShown } from './layout';
import { settingMessages as copy } from './messages';
import { RetentionSection } from './retention-section';
import type { SettingsSection } from './section';
import { loadSetting, reading, settingStore } from './store';

const Reading = () => (
  <p role="status" class="text-sm text-base-content/60">
    {copy.reading}
  </p>
);

/** A failed read hides the sections and offers the retry (settings.md Interface). */
const ReadFailed = () => (
  <div role="alert" class="alert alert-error">
    <span class="text-sm">{settingStore.readError()}</span>
    <Button
      type="button"
      class="btn btn-sm"
      onClick={() => {
        void loadSetting(settingStore);
      }}
    >
      {copy.retry}
    </Button>
  </div>
);

const SavingStatus = () => (
  <p
    role="status"
    aria-live="polite"
    class="rounded-box border border-base-300 bg-base-100 px-4 py-3 text-sm text-base-content/70"
  >
    {copy.savingStatus}
  </p>
);

export type SectionPanelsProps = {
  readonly layout: SettingsLayout;
  readonly section: SettingsSection;
};

/**
 * The four sections, always all mounted: the layout only decides which of them
 * are shown, so switching the layout hides or shows a section instead of
 * destroying it, and the drafts and the write in flight survive (settings.md
 * Interface). A hidden section carries the `hidden` attribute, so nothing in it
 * is focusable or read out.
 */
const ReadyPanels = (props: SectionPanelsProps) => {
  const shown = (section: SettingsSection): boolean =>
    sectionShown(props.layout, props.section, section);

  return (
    <>
      <Show when={settingStore.saving() !== undefined}>
        <SavingStatus />
      </Show>
      <AccountSection
        hidden={!shown('account')}
        saving={settingStore.saving() !== undefined}
      />
      <RetentionSection hidden={!shown('articles')} />
      <FetcherSection hidden={!shown('extraction')} />
      <KindleSection hidden={!shown('kindle')} />
    </>
  );
};

/** The sections area of `/settings`: reading, the failed read, or the sections. */
export const SectionPanels = (props: SectionPanelsProps) => (
  <>
    <Show when={reading(settingStore)}>
      <Reading />
    </Show>
    <Show when={settingStore.readError()}>
      <ReadFailed />
    </Show>
    <Show when={settingStore.setting()}>
      <ReadyPanels layout={props.layout} section={props.section} />
    </Show>
  </>
);
