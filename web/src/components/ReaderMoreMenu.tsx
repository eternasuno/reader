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
import { openInNewTab } from './openInNewTab';
import { ReaderViewOptionsPanel } from './ReaderAppearanceMenu';
import type { ReaderNav } from './readerNav';

export interface ReaderMoreMenuProps {
  article: LibraryArticle;
  nav: ReaderNav;
  onDelete: () => void;
  onRequestFeedOptions?: (feed: Feed) => void;
}

const articleFeed = (article: LibraryArticle): Feed | null => {
  if (article.kind !== 'feed') return null;
  return feeds().find((f) => f.id === article.feedId) ?? null;
};

const MoreMainPanel = (props: {
  article: LibraryArticle;
  onDelete: () => void;
  onOpenView: () => void;
  onRequestFeedOptions?: (feed: Feed) => void;
}): JSX.Element => (
  <>
    <MenuItem icon="book" onSelect={() => void triggerKindleSend()}>
      {String(t('reader.sendAsEbook'))}
    </MenuItem>
    <MenuDivider />
    <MenuItem
      icon="external-link"
      onSelect={() => openInNewTab(props.article.url)}
    >
      {String(t('reader.openOriginalInNewTab'))}
    </MenuItem>
    <MenuCheckbox
      icon="compass"
      checked={displayMode() === 'embedded'}
      onSelect={() => toggleEmbeddedMode()}
    >
      {String(t('reader.embeddedWebpageView'))}
    </MenuCheckbox>
    <MenuCheckbox
      icon="fullscreen"
      checked={readerFullscreen()}
      onSelect={() => toggleReaderFullscreen()}
    >
      {String(t('reader.fullscreen'))}
    </MenuCheckbox>
    <Show when={displayMode() !== 'embedded'}>
      <MenuItem submenu keepOpen icon="typography" onSelect={props.onOpenView}>
        {String(t('reader.appearance'))}
      </MenuItem>
    </Show>
    <Show when={articleFeed(props.article)}>
      {(feed) => (
        <>
          <MenuDivider />
          <MenuItem onSelect={() => props.onRequestFeedOptions?.(feed())}>
            {String(t('feeds.feedOptions'))}
          </MenuItem>
        </>
      )}
    </Show>
    <Show when={props.article.kind === 'later'}>
      <MenuDivider />
      <MenuItem danger icon="trash" onSelect={props.onDelete}>
        {String(t('reader.deleteArticle'))}
      </MenuItem>
    </Show>
  </>
);

/** `RD-WEBPAGE-1`: embedded view toggle, fullscreen toggle, view options sub-panel, feed options, original link, and saved-page delete. */
export function ReaderMoreMenu(props: ReaderMoreMenuProps): JSX.Element {
  const [panel, setPanel] = createSignal<'main' | 'view'>('main');

  return (
    <Menu
      label={String(t('reader.moreActions'))}
      align="end"
      triggerClass="btn-sm max-md:size-10"
      onOpenChange={(open) => {
        if (!open) setPanel('main');
      }}
    >
      <Show
        when={panel() === 'view'}
        fallback={
          <MoreMainPanel
            article={props.article}
            onDelete={props.onDelete}
            onOpenView={() => setPanel('view')}
            onRequestFeedOptions={props.onRequestFeedOptions}
          />
        }
      >
        <ReaderViewOptionsPanel
          onBack={() => setPanel('main')}
          onOpenSettings={() => props.nav.onNavigate('/settings')}
        />
      </Show>
    </Menu>
  );
}
