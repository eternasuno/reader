import type { JSX } from '@solidjs/web';
import { createUniqueId, For, Show } from 'solid-js';
import type { ExtractorProvider } from '../api';
import { feedsApi } from '../api';
import { t } from '../i18n';
import {
  isBrowserAvailable,
  isSaving,
  isSettingsReady,
  saveProvider,
  saveRetention,
  savingAction,
  settings,
} from '../state';
import { Button, Icon, Input, SettingsGroup, SettingsRow } from '../ui';
import { useOpmlImport } from './importOpml';
import type { SettingsDraftProps } from './settingsHelpers';

const controlsDisabled = (): boolean => isSaving() || !isSettingsReady();

const PROVIDERS = [
  {
    id: 'direct',
    labelKey: 'settings.providerDirect',
    hintKey: 'settings.providerDirectHint',
  },
  {
    id: 'jina',
    labelKey: 'settings.providerJina',
    hintKey: 'settings.providerJinaHint',
  },
  {
    id: 'browser',
    labelKey: 'settings.providerBrowser',
    hintKey: 'settings.providerBrowserHint',
  },
] as const satisfies ReadonlyArray<{
  id: ExtractorProvider;
  labelKey: string;
  hintKey: string;
}>;

function RetentionGroup(props: SettingsDraftProps): JSX.Element {
  const inputId = createUniqueId();

  return (
    <SettingsGroup
      title={String(t('settings.retentionHeading'))}
      footer={
        <Button
          variant="primary"
          size="sm"
          loading={savingAction() === 'retention'}
          disabled={controlsDisabled()}
          onClick={() => void saveRetention(props.drafts)}
        >
          {String(t('settings.saveArticles'))}
        </Button>
      }
    >
      <SettingsRow
        label={String(t('settings.retentionLabel'))}
        labelFor={inputId}
        description={String(t('settings.retentionHint'))}
      >
        <Input
          id={inputId}
          type="number"
          min={1}
          containerClass="sm:w-28"
          class="tabular-nums"
          value={String(props.drafts.retention)}
          disabled={controlsDisabled()}
          onInput={(event) => {
            const parsed = Number.parseInt(event.currentTarget.value, 10);
            const retention = Number.isNaN(parsed) ? 0 : parsed;
            props.setDrafts((draft) => ({ ...draft, retention }));
          }}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}

function OpmlGroup(): JSX.Element {
  const opml = useOpmlImport();

  return (
    <SettingsGroup title={String(t('settings.opmlHeading'))}>
      <SettingsRow description={String(t('settings.opmlHint'))}>
        <div class="flex flex-wrap items-center gap-2">
          <input
            ref={opml.inputRef}
            type="file"
            accept=".opml,.xml,text/xml,application/xml"
            class="hidden"
            onChange={opml.onChange}
          />
          <Button variant="secondary" size="sm" onClick={opml.openPicker}>
            {String(t('library.importOpml'))}
          </Button>
          <a
            class="btn btn-secondary btn-sm"
            href={feedsApi.exportOpmlUrl}
            download="subscriptions.opml"
          >
            {String(t('library.exportOpml'))}
          </a>
        </div>
      </SettingsRow>
    </SettingsGroup>
  );
}

function BookmarkletGroup(): JSX.Element {
  const href = (): string =>
    `javascript:location.href='${window.location.origin}/save#url='+encodeURIComponent(location.href)`;

  return (
    <SettingsGroup title={String(t('settings.bookmarkletHeading'))}>
      <SettingsRow description={String(t('settings.bookmarkletHint'))}>
        <a
          class="btn btn-sm cursor-grab border-dashed border-base-content/30 bg-base-100 active:cursor-grabbing"
          href={href()}
          draggable="true"
          onClick={(event) => event.preventDefault()}
        >
          <Icon name="bookmark" size={16} class="text-brand" />
          {String(t('settings.bookmarkletLabel'))}
        </a>
      </SettingsRow>
    </SettingsGroup>
  );
}

/** `settings.md:18`: articles & subscriptions: retention, OPML import/export, and the save bookmarklet. */
export function ArticlesSection(props: SettingsDraftProps): JSX.Element {
  return (
    <div class="flex flex-col gap-6">
      <RetentionGroup drafts={props.drafts} setDrafts={props.setDrafts} />
      <OpmlGroup />
      <BookmarkletGroup />
    </div>
  );
}

function BrowserUnavailableHint(props: {
  onGoToServices: () => void;
}): JSX.Element {
  return (
    <span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-warning">
      <Icon name="warning" size={14} />
      {String(t('settings.browserUnavailableHint'))}
      <Button
        variant="ghost"
        size="sm"
        class="btn-xs text-primary"
        disabled={controlsDisabled()}
        onClick={props.onGoToServices}
      >
        {String(t('settings.goToServices'))}
      </Button>
    </span>
  );
}

/** A selectable row: the label toggles the radio; disabled options stay legible. */
function ProviderOption(
  props: SettingsDraftProps & {
    provider: (typeof PROVIDERS)[number];
    onGoToServices: () => void;
  }
): JSX.Element {
  const browserUnavailable = (): boolean =>
    props.provider.id === 'browser' &&
    settings() !== null &&
    !isBrowserAvailable();

  return (
    <div class="flex flex-col gap-1 px-4 py-3.5 transition-colors has-[:checked]:bg-base-200">
      <label class="flex cursor-pointer items-start gap-3 has-[:disabled]:cursor-not-allowed">
        <input
          type="radio"
          class="radio radio-sm radio-primary mt-0.5 disabled:border-base-content/30 disabled:opacity-100"
          name="extractor-provider"
          value={props.provider.id}
          checked={props.drafts.provider === props.provider.id}
          disabled={controlsDisabled() || browserUnavailable()}
          onChange={() => {
            props.setDrafts((draft) => ({
              ...draft,
              provider: props.provider.id,
            }));
          }}
        />
        <span class="flex min-w-0 flex-col gap-1">
          <span
            class={[
              'text-sm font-medium',
              browserUnavailable() ? 'text-base-content/50' : '',
            ]}
          >
            {String(t(props.provider.labelKey))}
          </span>
          <span class="text-xs leading-relaxed text-base-content/60">
            {String(t(props.provider.hintKey))}
          </span>
        </span>
      </label>
      <Show when={browserUnavailable()}>
        <div class="pl-7">
          <BrowserUnavailableHint onGoToServices={props.onGoToServices} />
        </div>
      </Show>
    </div>
  );
}

/** `settings.md:19`: extraction provider choice; external services live under services. */
export function ExtractionSection(
  props: SettingsDraftProps & {
    onGoToServices: () => void;
  }
): JSX.Element {
  return (
    <fieldset disabled={controlsDisabled()}>
      <legend class="sr-only">{String(t('settings.providerLabel'))}</legend>
      <SettingsGroup
        title={String(t('settings.providerLabel'))}
        footer={
          <Button
            variant="primary"
            size="sm"
            loading={savingAction() === 'provider'}
            disabled={controlsDisabled()}
            onClick={() => void saveProvider(props.drafts)}
          >
            {String(t('settings.saveExtraction'))}
          </Button>
        }
      >
        <For each={PROVIDERS}>
          {(provider) => (
            <ProviderOption
              provider={provider}
              drafts={props.drafts}
              setDrafts={props.setDrafts}
              onGoToServices={props.onGoToServices}
            />
          )}
        </For>
      </SettingsGroup>
    </fieldset>
  );
}
