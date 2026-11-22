import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import { t } from '../i18n';
import { displayMode, type LibraryArticle, toggleEmbeddedMode } from '../state';
import { Menu, MenuCheckbox, MenuDivider, MenuItem } from '../ui';
import { openInNewTab } from './openInNewTab';
import type { ReaderNav } from './readerNav';

export interface ReaderMoreMenuProps {
  article: LibraryArticle;
  nav: ReaderNav;
  onDelete: () => void;
}

/** `RD-WEBPAGE-1`: embedded view toggle, original link, and saved-page delete. */
export function ReaderMoreMenu(props: ReaderMoreMenuProps): JSX.Element {
  return (
    <Menu
      label={String(t('reader.moreActions'))}
      align="end"
      triggerClass="btn-sm max-md:size-10"
    >
      <MenuCheckbox
        checked={displayMode() === 'embedded'}
        onSelect={() => toggleEmbeddedMode()}
      >
        {String(t('reader.embeddedWebpageView'))}
      </MenuCheckbox>
      <MenuItem
        icon="external-link"
        onSelect={() => openInNewTab(props.article.url)}
      >
        {String(t('reader.openOriginal'))}
      </MenuItem>
      <Show when={props.article.kind === 'later'}>
        <MenuDivider />
        <MenuItem danger icon="trash" onSelect={props.onDelete}>
          {String(t('reader.deleteArticle'))}
        </MenuItem>
      </Show>
    </Menu>
  );
}
