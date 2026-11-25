import type { JSX } from '@solidjs/web';
import { For } from 'solid-js';
import type { Feed } from '../api';
import { t } from '../i18n';
import { folders } from '../state';
import { Icon, MenuCheckbox, MenuDivider, MenuItem } from '../ui';

/** `FD-MOVE-1`: in-menu folder picker with a back header and a new-folder entry. */
export function FeedMoveSubpanel(props: {
  feed: Feed;
  onBack: () => void;
  onMove: (feed: Feed, folderId: string | null) => Promise<void>;
  onRequestNewFolder: (feed: Feed) => void;
}): JSX.Element {
  return (
    <>
      <button
        type="button"
        role="menuitem"
        data-keep-open="true"
        class="mx-2 flex min-h-10 w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm leading-5 text-base-content transition-colors hover:bg-base-300/70 focus-visible:bg-base-300/70 focus-visible:outline-none"
        onClick={props.onBack}
      >
        <span class="flex size-5 shrink-0 items-center justify-center">
          <Icon name="arrow-left" size={18} />
        </span>
        <span>{t('feeds.moveTo')}</span>
      </button>
      <MenuDivider />
      <For each={folders()} keyed={(folder) => folder.id}>
        {(folder) => (
          <MenuCheckbox
            checked={props.feed.folderId === folder().id}
            onSelect={() =>
              void props.onMove(
                props.feed,
                props.feed.folderId === folder().id ? null : folder().id
              )
            }
          >
            {folder().name}
          </MenuCheckbox>
        )}
      </For>
      <MenuDivider />
      <MenuItem
        opensDialog
        icon="plus"
        onSelect={() => props.onRequestNewFolder(props.feed)}
      >
        {t('library.newFolder')}
      </MenuItem>
    </>
  );
}
