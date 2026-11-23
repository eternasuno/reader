import type { JSX } from '@solidjs/web';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type Setter,
  Show,
  untrack,
} from 'solid-js';
import type { Feed, ReaderMode } from '../api';
import { t } from '../i18n';
import { changeFeedReaderMode, feeds } from '../state';
import { Button, Icon } from '../ui';
import { createOpenReset } from './createOpenReset';
import { SiteIcon } from './SiteIcon';

export interface FeedOptionsDialogProps {
  open: boolean;
  feed: Feed | null;
  onClose: () => void;
  onUnsubscribe?: (feed: Feed) => void;
}

interface FeedOptionsState {
  selectedMode: Accessor<ReaderMode>;
  setSelectedMode: Setter<ReaderMode>;
  saving: Accessor<boolean>;
  setSaving: Setter<boolean>;
}

const READER_MODES: ReadonlyArray<{
  mode: ReaderMode;
  label: 'feeds.modeDefault' | 'feeds.modeExtracted' | 'feeds.modeEmbedded';
}> = [
  { mode: 'default', label: 'feeds.modeDefault' },
  { mode: 'extracted', label: 'feeds.modeExtracted' },
  { mode: 'embedded', label: 'feeds.modeEmbedded' },
];

const useEscapeToClose = (
  isOpen: () => boolean,
  canClose: () => boolean,
  close: () => void
): void => {
  createEffect(isOpen, (open) => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented && canClose()) {
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });
};

/**
 * `feeds.md`: feed options dialog showing feed metadata and default reader mode.
 */
export function FeedOptionsDialog(props: FeedOptionsDialogProps): JSX.Element {
  const [saving, setSaving] = createSignal(false);
  const [selectedMode, setSelectedMode] = createSignal<ReaderMode>('default');
  const state: FeedOptionsState = {
    selectedMode,
    setSelectedMode,
    saving,
    setSaving,
  };

  const liveFeed = createMemo<Feed | null>(
    () => feeds().find((entry) => entry.id === props.feed?.id) ?? props.feed
  );
  const feedMode = createMemo<ReaderMode | undefined>(
    () => liveFeed()?.readerMode
  );

  createOpenReset(
    () => props.open,
    () => {
      setSaving(false);
      setSelectedMode(untrack(feedMode) ?? 'default');
    }
  );

  createEffect(feedMode, (mode) => {
    if (mode !== undefined) setSelectedMode(mode);
  });

  useEscapeToClose(
    () => props.open,
    () => !saving(),
    props.onClose
  );

  return (
    <Show when={props.open && liveFeed()}>
      {(feed) => (
        <FeedOptionsDrawer
          feed={feed()}
          mode={selectedMode()}
          busy={saving()}
          onClose={() => {
            if (!saving()) props.onClose();
          }}
          onModeChange={(nextMode) =>
            void updateReaderMode(feed(), nextMode, state)
          }
          onUnsubscribe={props.onUnsubscribe}
        />
      )}
    </Show>
  );
}

const feedSiteOrigin = (url: string): string => {
  try {
    return `${new URL(url).origin}/`;
  } catch {
    return url;
  }
};

function FeedOptionsDrawer(props: {
  feed: Feed;
  mode: ReaderMode;
  busy: boolean;
  onClose: () => void;
  onModeChange: (mode: ReaderMode) => void;
  onUnsubscribe?: (feed: Feed) => void;
}): JSX.Element {
  return (
    <div class="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        class="fixed inset-0 bg-black/25"
        aria-label={String(t('common.close'))}
        disabled={props.busy}
        onClick={props.onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={String(t('feeds.feedOptionsTitle'))}
        class="relative z-10 flex h-full w-[360px] max-w-full flex-col border-l border-base-300 bg-base-100 text-base-content shadow-2xl"
      >
        <nav class="sticky top-0 z-20 flex h-13 shrink-0 items-center justify-between bg-base-100 px-5">
          <h2 class="text-base font-medium text-base-content">
            {String(t('feeds.feedOptionsTitle'))}
          </h2>
          <Button
            variant="icon"
            size="sm"
            class="rounded-full bg-base-200"
            aria-label={String(t('common.close'))}
            disabled={props.busy}
            onClick={props.onClose}
          >
            <Icon name="close" size={18} />
          </Button>
        </nav>
        <FeedOptionsBody
          feed={props.feed}
          mode={props.mode}
          busy={props.busy}
          onModeChange={props.onModeChange}
          onUnsubscribe={props.onUnsubscribe}
        />
      </aside>
    </div>
  );
}

function FeedOptionsBody(props: {
  feed: Feed;
  mode: ReaderMode;
  busy: boolean;
  onModeChange: (mode: ReaderMode) => void;
  onUnsubscribe?: (feed: Feed) => void;
}): JSX.Element {
  const siteUrl = () => feedSiteOrigin(props.feed.url);

  return (
    <div class="flex flex-1 flex-col gap-7 overflow-y-auto px-5 py-4">
      <div class="my-2 flex justify-center">
        <SiteIcon url={props.feed.url} fallback="rss" size={56} />
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-base-content/60">
          {String(t('feeds.titleLabel'))}
        </span>
        <div class="flex items-center justify-between gap-2">
          <p class="text-sm font-medium break-words text-base-content">
            {props.feed.title}
          </p>
          <Icon name="edit" size={16} class="shrink-0 text-base-content/60" />
        </div>
      </div>
      <FeedDefaultViewSelect
        mode={props.mode}
        busy={props.busy}
        onModeChange={props.onModeChange}
      />
      <FeedExternalLinkSection
        label={String(t('feeds.websiteLabel'))}
        href={siteUrl()}
      />
      <FeedExternalLinkSection label="RSS" href={props.feed.url} />
      <Show when={props.onUnsubscribe}>
        {(unsubscribe) => (
          <div>
            <Button
              variant="ghost"
              class="btn-outline border-error/60 text-error hover:bg-error/10"
              disabled={props.busy}
              onClick={() => unsubscribe()(props.feed)}
            >
              <Icon name="trash" size={16} />
              {String(t('feeds.deleteFeed'))}
            </Button>
          </div>
        )}
      </Show>
    </div>
  );
}

function FeedDefaultViewSelect(props: {
  mode: ReaderMode;
  busy: boolean;
  onModeChange: (mode: ReaderMode) => void;
}): JSX.Element {
  return (
    <div class="flex flex-col gap-1.5">
      <label for="feed-default-display" class="text-xs text-base-content/60">
        {String(t('feeds.defaultDisplay'))}
      </label>
      <select
        id="feed-default-display"
        class="h-10 w-fit min-w-44 rounded border border-base-300 bg-base-200 px-2.5 text-sm text-base-content focus:border-primary focus:outline-none disabled:opacity-50"
        value={props.mode}
        disabled={props.busy}
        onChange={(event) =>
          props.onModeChange(event.currentTarget.value as ReaderMode)
        }
      >
        <For each={READER_MODES}>
          {(option) => (
            <option value={option.mode}>{String(t(option.label))}</option>
          )}
        </For>
      </select>
      <p class="text-xs text-base-content/60">
        {String(t('feeds.defaultDisplayHint'))}
      </p>
    </div>
  );
}

function FeedExternalLinkSection(props: {
  label: string;
  href: string;
}): JSX.Element {
  return (
    <div class="flex flex-col gap-1">
      <span class="text-xs text-base-content/60">{props.label}</span>
      <a
        href={props.href}
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 text-sm break-all text-base-content/90 underline hover:text-base-content"
      >
        <span>{props.href}</span>
        <Icon name="external-link" size={14} class="shrink-0 opacity-70" />
      </a>
    </div>
  );
}

const updateReaderMode = async (
  feed: Feed,
  nextMode: ReaderMode,
  state: FeedOptionsState
): Promise<void> => {
  if (state.saving()) return;

  const previousMode = state.selectedMode();
  state.setSelectedMode(nextMode);
  state.setSaving(true);
  try {
    const ok = await changeFeedReaderMode(feed, nextMode);
    if (!ok) state.setSelectedMode(previousMode);
  } finally {
    state.setSaving(false);
  }
};
