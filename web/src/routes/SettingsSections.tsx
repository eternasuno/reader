import type { JSX } from '@solidjs/web';
import { createUniqueId } from 'solid-js';
import { feedsApi } from '../api';
import { t } from '../i18n';
import {
  isSaving,
  isSettingsReady,
  parseRetentionDraft,
  saveRetention,
  savingAction,
} from '../state';
import { Button, Icon, Input, SettingsGroup, SettingsRow } from '../ui';
import { useOpmlImport } from './importOpml';
import type { SettingsDraftProps } from './settingsHelpers';

const controlsDisabled = (): boolean => isSaving() || !isSettingsReady();

function RetentionGroup(props: SettingsDraftProps): JSX.Element {
  const inputId = createUniqueId();

  return (
    <SettingsGroup
      title={t('settings.retentionHeading')}
      footer={
        <Button
          variant="primary"
          size="sm"
          loading={savingAction() === 'retention'}
          disabled={
            controlsDisabled() ||
            parseRetentionDraft(props.drafts.retention) === undefined
          }
          onClick={() => void saveRetention(props.drafts)}
        >
          {t('settings.saveArticles')}
        </Button>
      }
    >
      <SettingsRow
        label={t('settings.retentionLabel')}
        labelFor={inputId}
        description={t('settings.retentionHint')}
      >
        <Input
          id={inputId}
          name="retention"
          type="text"
          inputmode="numeric"
          containerClass="sm:w-28"
          class="tabular-nums"
          value={props.drafts.retention}
          disabled={controlsDisabled()}
          onInput={(event) => {
            const retention = event.currentTarget.value;
            props.setDrafts((draft) => {
              draft.retention = retention;
            });
          }}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}

function OpmlGroup(): JSX.Element {
  const opml = useOpmlImport();

  return (
    <SettingsGroup title={t('settings.opmlHeading')}>
      <SettingsRow description={t('settings.opmlHint')}>
        <div class="flex flex-wrap items-center gap-2">
          <input
            ref={opml.inputRef}
            type="file"
            accept=".opml,.xml,text/xml,application/xml"
            class="hidden"
            onChange={opml.onChange}
          />
          <Button variant="secondary" size="sm" onClick={opml.openPicker}>
            {t('library.importOpml')}
          </Button>
          <a
            class="btn btn-secondary btn-sm"
            href={feedsApi.exportOpmlUrl}
            download="subscriptions.opml"
          >
            {t('library.exportOpml')}
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
    <SettingsGroup title={t('settings.bookmarkletHeading')}>
      <SettingsRow description={t('settings.bookmarkletHint')}>
        <a
          class="btn btn-sm cursor-grab border-dashed border-base-content/30 bg-base-100 active:cursor-grabbing"
          href={href()}
          draggable="true"
          onClick={(event) => event.preventDefault()}
        >
          <Icon name="bookmark" size={16} class="text-brand" />
          {t('settings.bookmarkletLabel')}
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
