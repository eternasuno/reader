import type { JSX } from '@solidjs/web';
import { createSignal, Show } from 'solid-js';
import type { Feed } from '../api';
import { t } from '../i18n';
import {
  displayMode,
  feeds,
  type LibraryArticle,
  readerFullscreen,
  toggleEmbeddedMode,
  toggleReaderFullscreen,
  triggerKindleSend,
} from '../state';
import { Menu, MenuCheckbox, MenuDivider, MenuItem } from '../ui';
import { FeedReaderModeSubpanel } from './FeedReaderModeSubpanel';
import { openInNewTab } from './openInNewTab';
import { ReaderViewOptionsPanel } from './ReaderAppearanceMenu';

export interface ReaderMoreMenuProps {
  article: LibraryArticle;
  onDelete: () => void;
}

const articleFeed = (article: LibraryArticle): Feed | null => {
  if (article.kind !== 'feed') return null;

  return feeds().find((f) => f.id === article.feedId) ?? null;
};

const MoreMainPanel = (props: {
  article: LibraryArticle;
  onDelete: () => void;
  onOpenView: () => void;
  onOpenMode: () => void;
}): JSX.Element => (
  <>
    <MenuItem icon="book" onSelect={() => void triggerKindleSend()}>
      {t('reader.sendAsEbook')}
    </MenuItem>
    <MenuDivider />
    <MenuItem
      icon="external-link"
      onSelect={() => openInNewTab(props.article.url)}
    >
      {t('reader.openOriginalInNewTab')}
    </MenuItem>
    <MenuCheckbox
      icon="compass"
      checked={displayMode() === 'embedded'}
      onSelect={() => toggleEmbeddedMode()}
    >
      {t('reader.embeddedWebpageView')}
    </MenuCheckbox>
    <MenuCheckbox
      icon="fullscreen"
      checked={readerFullscreen()}
      onSelect={() => toggleReaderFullscreen()}
    >
      {t('reader.fullscreen')}
    </MenuCheckbox>
    <Show when={displayMode() !== 'embedded'}>
      <MenuItem submenu icon="typography" onSelect={props.onOpenView}>
        {t('reader.appearance')}
      </MenuItem>
    </Show>
    <Show when={articleFeed(props.article) !== null}>
      <MenuDivider />
      <MenuItem submenu onSelect={props.onOpenMode}>
        {t('feeds.defaultDisplay')}
      </MenuItem>
    </Show>
    <Show when={props.article.kind === 'later'}>
      <MenuDivider />
      <MenuItem danger icon="trash" onSelect={props.onDelete}>
        {t('reader.deleteArticle')}
      </MenuItem>
    </Show>
  </>
);

/** `RD-WEBPAGE-1`: embedded view toggle, fullscreen toggle, view options sub-panel, feed default view sub-panel, original link, and saved-page delete. */
export function ReaderMoreMenu(props: ReaderMoreMenuProps): JSX.Element {
  const [panel, setPanel] = createSignal<'main' | 'view' | 'mode'>('main');

  return (
    <Menu
      label={t('reader.moreActions')}
      triggerClass="btn-sm max-md:size-10"
      onOpenChange={(open) => {
        if (!open) setPanel('main');
      }}
    >
      <Show
        when={panel() === 'view'}
        fallback={
          <Show
            when={panel() === 'mode' && articleFeed(props.article)}
            fallback={
              <MoreMainPanel
                article={props.article}
                onDelete={props.onDelete}
                onOpenView={() => setPanel('view')}
                onOpenMode={() => setPanel('mode')}
              />
            }
          >
            {(feed) => (
              <FeedReaderModeSubpanel
                feed={feed()}
                onBack={() => setPanel('main')}
              />
            )}
          </Show>
        }
      >
        <ReaderViewOptionsPanel onBack={() => setPanel('main')} />
      </Show>
    </Menu>
  );
}
