import type { JSX } from '@solidjs/web';
import { For } from 'solid-js';
import type { Feed, ReaderMode } from '../api';
import { t } from '../i18n';
import { changeFeedReaderMode, feeds } from '../state';
import { Icon, MenuDivider, MenuRadio } from '../ui';

const READER_MODES: ReadonlyArray<{
  mode: ReaderMode;
  label: 'feeds.modeDefault' | 'feeds.modeExtracted';
}> = [
  { mode: 'default', label: 'feeds.modeDefault' },
  { mode: 'extracted', label: 'feeds.modeExtracted' },
];

/**
 * `FD-PREF-1` / `RD-MODE-1`: in-menu picker for a feed's stored starting view. The
 * embedded webpage view is not offered here; it is only a temporary reader toggle.
 */
export function FeedReaderModeSubpanel(props: {
  feed: Feed;
  onBack: () => void;
}): JSX.Element {
  const mode = (): ReaderMode =>
    feeds().find((entry) => entry.id === props.feed.id)?.readerMode ??
    props.feed.readerMode;

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
        <span>{t('feeds.defaultDisplay')}</span>
      </button>
      <MenuDivider />
      <div data-keep-open="true">
        <For each={READER_MODES}>
          {(option) => (
            <MenuRadio
              checked={mode() === option.mode}
              onSelect={() => {
                if (mode() !== option.mode) {
                  void changeFeedReaderMode(props.feed, option.mode);
                }
              }}
            >
              {t(option.label)}
            </MenuRadio>
          )}
        </For>
      </div>
    </>
  );
}
