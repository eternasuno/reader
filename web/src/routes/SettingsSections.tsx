import type { JSX } from '@solidjs/web';
import { For, Show } from 'solid-js';
import type { ExtractorProvider } from '../api';
import { feedsApi } from '../api';
import { t } from '../i18n';
import {
  browserEndpointDraft,
  isSaving,
  jinaKeyDraft,
  providerDraft,
  removeJinaKey,
  retentionDraft,
  saveExtraction,
  saveRetention,
  savingAction,
  setBrowserEndpointDraft,
  setJinaKeyDraft,
  setProviderDraft,
  setRetentionDraft,
  settings,
} from '../state';
import { Button, Input } from '../ui';
import { useOpmlImport } from './importOpml';
import { statusKey } from './settingsHelpers';

const PROVIDERS = [
  { id: 'direct', labelKey: 'settings.providerDirect' },
  { id: 'jina', labelKey: 'settings.providerJina' },
  { id: 'browser', labelKey: 'settings.providerBrowser' },
] as const satisfies ReadonlyArray<{ id: ExtractorProvider; labelKey: string }>;

function RetentionForm(): JSX.Element {
  return (
    <>
      <Input
        type="number"
        min={1}
        label={String(t('settings.retentionLabel'))}
        hint={String(t('settings.retentionHint'))}
        value={String(retentionDraft())}
        disabled={isSaving()}
        onInput={(event) => {
          const parsed = Number.parseInt(event.currentTarget.value, 10);
          setRetentionDraft(Number.isNaN(parsed) ? 0 : parsed);
        }}
      />
      <div>
        <Button
          variant="primary"
          loading={savingAction() === 'retention'}
          disabled={isSaving()}
          onClick={() => void saveRetention()}
        >
          {String(t('settings.saveArticles'))}
        </Button>
      </div>
    </>
  );
}

function OpmlSettings(): JSX.Element {
  const opml = useOpmlImport();

  return (
    <div class="flex flex-col gap-2 border-t border-base-300 pt-4">
      <h2 class="text-sm font-semibold">{String(t('settings.opmlHeading'))}</h2>
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
          class="btn btn-ghost btn-sm"
          href={feedsApi.exportOpmlUrl}
          download="subscriptions.opml"
        >
          {String(t('library.exportOpml'))}
        </a>
      </div>
    </div>
  );
}

function BookmarkletSettings(): JSX.Element {
  const href = (): string =>
    `javascript:location.href='${window.location.origin}/save?url='+encodeURIComponent(location.href)`;

  return (
    <div class="flex flex-col gap-2 border-t border-base-300 pt-4">
      <h2 class="text-sm font-semibold">
        {String(t('settings.bookmarkletHeading'))}
      </h2>
      <a
        class="link link-primary w-fit text-sm"
        href={href()}
        draggable="true"
        onClick={(event) => event.preventDefault()}
      >
        {String(t('settings.bookmarkletLabel'))}
      </a>
      <p class="text-xs text-base-content/60">
        {String(t('settings.bookmarkletHint'))}
      </p>
    </div>
  );
}

/** `settings.md:15`: articles & subscriptions: retention, OPML import/export, and the save bookmarklet. */
export function ArticlesSection(): JSX.Element {
  return (
    <div class="flex max-w-xl flex-col gap-5">
      <RetentionForm />
      <OpmlSettings />
      <BookmarkletSettings />
    </div>
  );
}

const statusSummary = (): string =>
  String(
    t('settings.extractionStatus', {
      jina: String(t(statusKey(settings()?.jinaKeyConfigured))),
      browser: String(t(statusKey(settings()?.browserEndpointConfigured))),
    })
  );

function ProviderPicker(): JSX.Element {
  return (
    <fieldset class="flex flex-col gap-2">
      <legend class="mb-1 text-sm font-medium text-base-content/80">
        {String(t('settings.providerLabel'))}
      </legend>
      <For each={PROVIDERS}>
        {(provider) => (
          <label class="flex items-center gap-2 text-sm">
            <input
              type="radio"
              class="radio radio-sm"
              name="extractor-provider"
              value={provider.id}
              checked={providerDraft() === provider.id}
              disabled={isSaving()}
              onChange={() => setProviderDraft(provider.id)}
            />
            <span>{String(t(provider.labelKey))}</span>
          </label>
        )}
      </For>
    </fieldset>
  );
}

function JinaKeyField(): JSX.Element {
  return (
    <div class="flex flex-col gap-2">
      <Input
        type="password"
        autocomplete="off"
        label={String(t('settings.jinaKeyLabel'))}
        placeholder={String(t('settings.jinaKeyPlaceholder'))}
        value={jinaKeyDraft()}
        disabled={isSaving()}
        onInput={(event) => setJinaKeyDraft(event.currentTarget.value)}
      />
      <Show when={settings()?.jinaKeyConfigured}>
        <div>
          <Button
            variant="danger"
            size="sm"
            disabled={isSaving()}
            onClick={() => void removeJinaKey()}
          >
            {String(t('settings.deleteJinaKey'))}
          </Button>
        </div>
      </Show>
    </div>
  );
}

function BrowserEndpointField(): JSX.Element {
  return (
    <Input
      type="url"
      label={String(t('settings.browserEndpointLabel'))}
      placeholder={String(t('settings.browserEndpointPlaceholder'))}
      value={browserEndpointDraft()}
      disabled={isSaving()}
      onInput={(event) => setBrowserEndpointDraft(event.currentTarget.value)}
    />
  );
}

/** `settings.md:15`: extraction: provider choice plus the provider-specific credential field. */
export function ExtractionSection(): JSX.Element {
  return (
    <div class="flex max-w-xl flex-col gap-5">
      <p class="text-sm text-base-content/70">{statusSummary()}</p>
      <ProviderPicker />
      <Show when={providerDraft() === 'jina'}>
        <JinaKeyField />
      </Show>
      <Show when={providerDraft() === 'browser'}>
        <BrowserEndpointField />
      </Show>
      <div>
        <Button
          variant="primary"
          loading={savingAction() === 'extraction'}
          disabled={isSaving()}
          onClick={() => void saveExtraction()}
        >
          {String(t('settings.saveExtraction'))}
        </Button>
      </div>
    </div>
  );
}
