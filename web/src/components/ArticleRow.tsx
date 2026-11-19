import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import { formatRelativeTime, locale, t } from '../i18n';
import {
  buildLibraryUrl,
  htmlToPlainText,
  type LibraryArticle,
  type LibraryScope,
  toggleArticleRead,
} from '../state';
import { openInNewTab } from './openInNewTab';

export interface ArticleRowProps {
  row: LibraryArticle;
  scope: LibraryScope;
  unreadOnly: boolean;
  active: boolean;
  onNavigate: (url: string) => void;
}

const isPlainPrimaryClick = (event: MouseEvent): boolean =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

/**
 * `LIB-ROW-1`: source, relative time, title (3 lines), summary (2 lines), and an
 * independent read toggle. Plain left-click opens the reader; modified and middle
 * clicks open the original URL in a new tab.
 */
export function ArticleRow(props: ArticleRowProps): JSX.Element {
  const href = (): string =>
    buildLibraryUrl(props.scope, {
      articleId: props.row.id,
      unreadOnly: props.unreadOnly,
    });
  const summary = (): string =>
    htmlToPlainText(props.row.description ?? props.row.content);
  const readLabel = (): string =>
    String(t(props.row.read ? 'reader.markUnread' : 'reader.markRead'));

  const onClick = (event: MouseEvent): void => {
    if (!isPlainPrimaryClick(event)) {
      event.preventDefault();
      openInNewTab(props.row.url);
      return;
    }

    event.preventDefault();
    props.onNavigate(href());
  };

  const onAuxClick = (event: MouseEvent): void => {
    if (event.button !== 1) return;
    event.preventDefault();
    openInNewTab(props.row.url);
  };

  return (
    <div
      class={[
        'flex items-start gap-2 border-b border-base-300 px-3 py-2 transition-colors',
        props.active ? 'bg-base-200' : 'hover:bg-base-200/50',
      ]}
    >
      <a
        href={href()}
        class="flex min-w-0 flex-1 flex-col gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
        onClick={onClick}
        onAuxClick={onAuxClick}
      >
        <RowSourceMeta row={props.row} />
        <RowTitle row={props.row} />
        <Show when={summary()}>
          {(text) => (
            <span class="line-clamp-2 text-xs leading-relaxed text-base-content/50">
              {text()}
            </span>
          )}
        </Show>
      </a>
      <ReadToggle row={props.row} label={readLabel()} />
    </div>
  );
}

function RowSourceMeta(props: { row: LibraryArticle }): JSX.Element {
  return (
    <span class="flex items-center gap-1.5 text-xs text-base-content/50">
      <span class="truncate">{props.row.sourceTitle}</span>
      <Show when={props.row.publishedAt}>
        {(publishedAt) => (
          <>
            <span aria-hidden="true">·</span>
            <time class="shrink-0" datetime={publishedAt()}>
              {formatRelativeTime(publishedAt(), locale())}
            </time>
          </>
        )}
      </Show>
    </span>
  );
}

function RowTitle(props: { row: LibraryArticle }): JSX.Element {
  return (
    <span
      class={[
        'line-clamp-3 text-sm leading-snug',
        props.row.read
          ? 'text-base-content/60'
          : 'font-medium text-base-content',
      ]}
    >
      {props.row.title}
    </span>
  );
}

function ReadToggle(props: {
  row: LibraryArticle;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      class="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-base-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-pressed={props.row.read ? 'true' : 'false'}
      aria-label={props.label}
      title={props.label}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void toggleArticleRead(props.row.id, !props.row.read);
      }}
    >
      <span
        class={[
          'size-2.5 rounded-full border',
          props.row.read
            ? 'border-base-content/30 bg-transparent'
            : 'border-primary bg-primary',
        ]}
        aria-hidden="true"
      />
    </button>
  );
}
