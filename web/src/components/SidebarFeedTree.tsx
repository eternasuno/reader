import type { JSX } from '@solidjs/web';
import { For } from 'solid-js';
import type { Feed } from '../api';
import { t } from '../i18n';
import { folders, topLevelFeeds } from '../state';
import { Menu, MenuItem } from '../ui';
import { FeedRow } from './FeedRow';
import { FolderRow } from './FolderRow';
import type { SidebarProps } from './sidebarProps';

/** `folders.md:16-17`: the feeds section, its folders, and top-level feeds. */
export function SidebarFeedTree(props: { state: SidebarProps }): JSX.Element {
  return (
    <>
      <FeedTreeHeader state={props.state} />
      <div class="flex flex-col gap-0.5 pb-2">
        {/* `FD-FOLDER-5`: folders render in the server's UTF-8 byte order. */}
        <For each={folders()}>
          {(folder) => <FolderRow folder={folder} state={props.state} />}
        </For>
        <For each={topLevelFeeds()}>
          {(feed) => <TopLevelFeedRow feed={feed} state={props.state} />}
        </For>
      </div>
    </>
  );
}

function TopLevelFeedRow(props: {
  feed: Feed;
  state: SidebarProps;
}): JSX.Element {
  return (
    <FeedRow
      feed={props.feed}
      showMove={folders().length > 0}
      state={props.state}
    />
  );
}

function FeedTreeHeader(props: { state: SidebarProps }): JSX.Element {
  return (
    <div class="mt-3 flex items-center justify-between gap-2 px-2">
      <h2 class="text-xs font-semibold tracking-wider text-base-content/50 uppercase">
        {String(t('library.feedsSection'))}
      </h2>
      <Menu
        icon="plus"
        label={String(t('library.addMenuLabel'))}
        align="end"
        triggerClass="btn-xs"
      >
        <MenuItem icon="rss" onSelect={props.state.onRequestAddFeed}>
          {String(t('library.addFeed'))}
        </MenuItem>
        <MenuItem icon="folder" onSelect={props.state.onRequestNewFolder}>
          {String(t('library.newFolder'))}
        </MenuItem>
        <MenuItem icon="inbox" onSelect={props.state.onRequestImportOpml}>
          {String(t('library.importOpml'))}
        </MenuItem>
      </Menu>
    </div>
  );
}
