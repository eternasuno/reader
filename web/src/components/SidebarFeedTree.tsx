import type { JSX } from '@solidjs/web';
import { For } from 'solid-js';
import { feedsApi } from '../api';
import { t } from '../i18n';
import { folders, topLevelFeeds } from '../state';
import { Icon, Menu, MenuItem } from '../ui';
import { FeedRow } from './FeedRow';
import { FolderRow } from './FolderRow';
import type { SidebarProps } from './sidebarProps';

/** `FD-FOLDER-5`, `FD-OPML-1`, `FD-OPML-2`: the feeds section, its folders, and top-level feeds. */
export function SidebarFeedTree(props: { state: SidebarProps }): JSX.Element {
  return (
    <>
      <FeedTreeHeader state={props.state} />
      <div class="flex flex-col gap-0.5 pb-2">
        {/* `FD-FOLDER-5`: folders render in the server's UTF-8 byte order. */}
        <For each={folders()} keyed={(folder) => folder.id}>
          {(folder) => <FolderRow folder={folder()} state={props.state} />}
        </For>
        <For each={topLevelFeeds()} keyed={(feed) => feed.id}>
          {(feed) => <FeedRow feed={feed()} state={props.state} />}
        </For>
      </div>
    </>
  );
}

function FeedTreeHeader(props: { state: SidebarProps }): JSX.Element {
  return (
    <div class="mt-3 flex items-center justify-between gap-2 px-2">
      <h2 class="text-xs font-semibold tracking-wider text-base-content/50 uppercase">
        {t('library.feedsSection')}
      </h2>
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square pointer-coarse:size-9"
          aria-label={t('library.addFeed')}
          title={t('library.addFeed')}
          onClick={props.state.onRequestAddFeed}
        >
          <Icon name="plus" size={16} />
        </button>
        <Menu
          label={t('library.moreActions')}
          triggerClass="btn-xs pointer-coarse:size-9"
        >
          <MenuItem onSelect={props.state.onRequestImportOpml}>
            {t('library.importOpmlMenu')}
          </MenuItem>
          <MenuItem
            onSelect={() => window.location.assign(feedsApi.exportOpmlUrl)}
          >
            {t('library.exportOpmlMenu')}
          </MenuItem>
        </Menu>
      </div>
    </div>
  );
}
