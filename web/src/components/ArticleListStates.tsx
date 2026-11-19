import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import { t } from '../i18n';
import { buildLibraryUrl, type LibraryScope, retryLoad } from '../state';
import { Button, Icon } from '../ui';
import type { EmptyCopy } from './articleListScope';

/** Page-level load failure: the list keeps its last rows and offers a retry. */
export function ArticleListError(): JSX.Element {
  return (
    <div
      role="alert"
      class="flex items-start gap-2 border-b border-error/30 bg-error/10 px-3 py-2"
    >
      <Icon name="warning" size={16} class="mt-0.5 text-error" />
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <p class="text-sm font-medium">{String(t('library.loadErrorTitle'))}</p>
        <p class="text-xs text-base-content/60">
          {String(t('library.loadErrorHint'))}
        </p>
      </div>
      <Button variant="secondary" size="sm" onClick={() => void retryLoad()}>
        {String(t('common.retry'))}
      </Button>
    </div>
  );
}

export function ArticleListLoading(): JSX.Element {
  return (
    <p class="px-3 py-4 text-sm text-base-content/60" role="status">
      {String(t('library.loading'))}
    </p>
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
      <p class="text-sm font-medium">{String(t('library.unreadEmptyTitle'))}</p>
      <p class="text-xs text-base-content/60">
        {String(t('library.unreadEmptyHint'))}
      </p>
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          props.onNavigate(buildLibraryUrl(props.scope, { unreadOnly: false }))
        }
      >
        {String(t('library.viewAllArticles'))}
      </Button>
    </>
  );
}

function ScopeEmptyCopy(props: { copy: EmptyCopy }): JSX.Element {
  return (
    <>
      <p class="text-sm font-medium">{props.copy.title}</p>
      <p class="text-xs text-base-content/60">{props.copy.hint}</p>
      <Show when={props.copy.action}>
        {(action) => (
          <Button variant="secondary" size="sm" onClick={action().run}>
            {action().label}
          </Button>
        )}
      </Show>
    </>
  );
}
