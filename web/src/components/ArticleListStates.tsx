import type { JSX } from '@solidjs/web';
import { For, Show } from 'solid-js';
import { t } from '../i18n';
import { buildLibraryUrl, type LibraryScope, retryLoad } from '../state';
import { Button, Icon } from '../ui';
import { ArticleRowSkeleton, SKELETON_HEIGHT } from './ArticleListBody';
import type { EmptyCopy } from './articleListScope';

export function ArticleListError(props: { compact?: boolean }): JSX.Element {
  return (
    <div
      role="alert"
      class={[
        'mx-2 my-2 flex shrink-0 gap-2 rounded-box border border-error/30 bg-error/10 px-3',
        props.compact ? 'items-center py-1' : 'items-start py-2.5',
      ]}
    >
      <Icon
        name="warning"
        size={16}
        class={props.compact ? 'text-error' : 'mt-0.5 text-error'}
      />
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <p class="text-sm font-medium">{t('library.loadErrorTitle')}</p>
        <Show when={!props.compact}>
          <p class="text-xs text-base-content/60">
            {t('library.loadErrorHint')}
          </p>
        </Show>
      </div>
      <Button variant="secondary" size="sm" onClick={() => void retryLoad()}>
        {t('common.retry')}
      </Button>
    </div>
  );
}

/** Enough skeleton cards to fill the tallest list the window allows; the last one is clipped. */
const loadingSkeletonRows = (): Array<number> =>
  Array.from(
    { length: Math.max(1, Math.ceil(window.innerHeight / SKELETON_HEIGHT)) },
    (_, index) => index
  );

/** The initial snapshot load shows the same skeleton cards as uncached rows. */
export function ArticleListLoading(props: {
  grouped: boolean;
  label: string;
}): JSX.Element {
  return (
    <div
      role="status"
      aria-label={props.label}
      class="min-h-0 flex-1 overflow-hidden"
    >
      <For each={loadingSkeletonRows()}>
        {() => <ArticleRowSkeleton grouped={props.grouped} />}
      </For>
    </div>
  );
}

export interface ArticleListEmptyProps {
  scope: LibraryScope;
  unreadOnly: boolean;
  copy: EmptyCopy;
  onNavigate: (url: string) => void;
}

/** `LIB-EMPTY-1`: an unread filter with no rows offers the unfiltered list. */
export function ArticleListEmpty(props: ArticleListEmptyProps): JSX.Element {
  return (
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      <Icon name="inbox" size={40} class="mb-1 opacity-30" />
      <Show
        when={props.unreadOnly}
        fallback={<ScopeEmptyCopy copy={props.copy} />}
      >
        <UnreadEmptyCopy scope={props.scope} onNavigate={props.onNavigate} />
      </Show>
    </div>
  );
}

function UnreadEmptyCopy(props: {
  scope: LibraryScope;
  onNavigate: (url: string) => void;
}): JSX.Element {
  return (
    <>
      <p class="text-base font-medium">{t('library.unreadEmptyTitle')}</p>
      <p class="text-sm text-base-content/60">{t('library.unreadEmptyHint')}</p>
      <Button
        variant="secondary"
        size="sm"
        class="mt-2"
        onClick={() =>
          props.onNavigate(buildLibraryUrl(props.scope, { unreadOnly: false }))
        }
      >
        {t('library.viewAllArticles')}
      </Button>
    </>
  );
}

function ScopeEmptyCopy(props: { copy: EmptyCopy }): JSX.Element {
  return (
    <>
      <p class="text-base font-medium">{props.copy.title}</p>
      <p class="text-sm text-base-content/60">{props.copy.hint}</p>
      <Show when={props.copy.action}>
        {(action) => (
          <Button
            variant="secondary"
            size="sm"
            class="mt-2"
            onClick={action().run}
          >
            {action().label}
          </Button>
        )}
      </Show>
    </>
  );
}
