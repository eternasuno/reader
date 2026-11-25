import type { JSX } from '@solidjs/web';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  type Setter,
  Show,
  untrack,
} from 'solid-js';
import type { Feed, ReaderMode } from '../api';
import { browserHref } from '../api/url';
import { t } from '../i18n';
import { changeFeedReaderMode, feeds } from '../state';
import { Button, Icon, useDialogFocus } from '../ui';
import { createOpenReset } from './createOpenReset';
import { SiteIcon } from './SiteIcon';

export interface FeedOptionsDialogProps {
  open: boolean;
  feed: Feed | null;
  onClose: () => void;
  onUnsubscribe?: (feed: Feed) => void | Promise<void>;
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

const useFeedOptionsController = (props: FeedOptionsDialogProps) => {
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

  return { state, liveFeed, saving, selectedMode };
};

/**
 * `FD-PREF-1` / `RD-MODE-1`: feed options drawer showing feed metadata and default reader mode.
 */
export function FeedOptionsDialog(props: FeedOptionsDialogProps): JSX.Element {
  let panel: HTMLElement | undefined;
  const ctl = useFeedOptionsController(props);

  useDialogFocus({
    open: () => Boolean(props.open && ctl.liveFeed()),
    panel: () => panel,
    dismissable: () => !ctl.saving(),
    onClose: () => props.onClose(),
  });

  return (
    <Show when={props.open && ctl.liveFeed()}>
      {(feed) => (
        <FeedOptionsDrawer
          feed={feed()}
          mode={ctl.selectedMode()}
          busy={ctl.saving()}
          panelRef={(el) => {
            panel = el;
          }}
          onClose={() => {
            if (!ctl.saving()) props.onClose();
          }}
          onModeChange={(nextMode) =>
            void updateReaderMode(feed(), nextMode, ctl.state)
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
  panelRef: (element: HTMLElement) => void;
  onClose: () => void;
  onModeChange: (mode: ReaderMode) => void;
  onUnsubscribe?: (feed: Feed) => void | Promise<void>;
}): JSX.Element {
  return (
    <div class="fixed inset-0 z-50 flex justify-end">
      <div
        class="fixed inset-0 bg-black/25"
        aria-hidden="true"
        onClick={props.onClose}
      />
      <aside
        ref={props.panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('feeds.feedOptionsTitle')}
        aria-busy={props.busy ? 'true' : undefined}
        tabindex="-1"
        class="relative z-10 flex h-full w-[360px] max-w-full flex-col border-l border-base-300 bg-base-100 text-base-content shadow-2xl focus:outline-none"
      >
        <nav class="sticky top-0 z-20 flex h-13 shrink-0 items-center justify-between bg-base-100 px-5">
          <h2 class="text-base font-medium text-base-content">
            {t('feeds.feedOptionsTitle')}
          </h2>
          <Button
            variant="icon"
            size="sm"
            class="rounded-full bg-base-200"
            aria-label={t('common.close')}
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
  onUnsubscribe?: (feed: Feed) => void | Promise<void>;
}): JSX.Element {
  const siteUrl = () => feedSiteOrigin(props.feed.url);

  return (
    <div class="flex flex-1 flex-col gap-7 overflow-y-auto px-5 py-4">
      <div class="my-2 flex justify-center">
        <SiteIcon url={props.feed.url} fallback="rss" size={56} />
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-base-content/60">
          {t('feeds.titleLabel')}
        </span>
        <p class="text-sm font-medium break-words text-base-content">
          {props.feed.title}
        </p>
      </div>
      <FeedDefaultViewSelect
        mode={props.mode}
        busy={props.busy}
        onModeChange={props.onModeChange}
      />
      <FeedExternalLinkSection
        label={t('feeds.websiteLabel')}
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
              onClick={() => void unsubscribe()(props.feed)}
            >
              <Icon name="trash" size={16} />
              {t('feeds.deleteFeed')}
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
  const selectId = createUniqueId();

  return (
    <div class="flex flex-col gap-1.5">
      <label for={selectId} class="text-xs text-base-content/60">
        {t('feeds.defaultDisplay')}
      </label>
      <select
        id={selectId}
        class="h-10 w-fit min-w-44 rounded border border-base-300 bg-base-200 px-2.5 text-sm text-base-content focus:border-primary focus:outline-none disabled:opacity-50"
        value={props.mode}
        disabled={props.busy}
        onChange={(event) =>
          props.onModeChange(event.currentTarget.value as ReaderMode)
        }
      >
        <For each={READER_MODES}>
          {(option) => <option value={option.mode}>{t(option.label)}</option>}
        </For>
      </select>
      <p class="text-xs text-base-content/60">
        {t('feeds.defaultDisplayHint')}
      </p>
    </div>
  );
}

function FeedExternalLinkSection(props: {
  label: string;
  href: string;
}): JSX.Element {
  const linkClass =
    'inline-flex items-center gap-1 text-sm break-all text-base-content/90 underline hover:text-base-content';

  return (
    <div class="flex flex-col gap-1">
      <span class="text-xs text-base-content/60">{props.label}</span>
      <Show
        when={browserHref(props.href)}
        fallback={<span class={linkClass}>{props.href}</span>}
      >
        {(href) => (
          <a
            href={href()}
            target="_blank"
            rel="noopener noreferrer"
            class={linkClass}
          >
            <span>{props.href}</span>
            <Icon name="external-link" size={14} class="shrink-0 opacity-70" />
          </a>
        )}
      </Show>
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
