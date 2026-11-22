import type { JSX } from '@solidjs/web';
import { For } from 'solid-js';
import type { Feed, ReaderMode } from '../api';
import { t } from '../i18n';
import { changeFeedReaderMode } from '../state';
import { MenuRadio } from '../ui';

interface ModeOption {
  mode: ReaderMode;
  label: Parameters<typeof t>[0];
}

const READER_MODES: ReadonlyArray<ModeOption> = [
  { mode: 'default', label: 'feeds.modeDefault' },
  { mode: 'extracted', label: 'feeds.modeExtracted' },
  { mode: 'embedded', label: 'feeds.modeEmbedded' },
];

/**
 * `feeds.md`: the default-display radio group, one option per reader mode. Shared by
 * the feed row menu and the library heading menu.
 */
export function FeedDisplayRadios(props: { feed: Feed }): JSX.Element {
  return (
    <>
      <p class="px-3 pt-1 pb-0.5 text-xs text-base-content/50">
        {String(t('feeds.defaultDisplay'))}
      </p>
      <For each={READER_MODES}>
        {(option) => (
          <MenuRadio
            checked={props.feed.readerMode === option.mode}
            onSelect={() => void changeFeedReaderMode(props.feed, option.mode)}
          >
            {String(t(option.label))}
          </MenuRadio>
        )}
      </For>
    </>
  );
}
