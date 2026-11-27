import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import { formatRelativeTime, locale, t } from '../i18n';
import {
  articleSource,
  buildLibraryUrl,
  htmlToPlainText,
  type LibraryArticle,
  type LibraryScope,
  toggleArticleRead,
} from '../state';
import { now } from '../state/clock';
import { openInNewTab } from './openInNewTab';
import { SiteIcon } from './SiteIcon';

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
 * `LIB-ROW-1`: card row with a leading read toggle, site icon + source, relative
 * time, title (3 lines), and summary (3 lines). Plain
 * left-click opens the reader; modified and middle clicks open the original URL.
 */
export function ArticleRow(props: ArticleRowProps): JSX.Element {
  const href = (): string =>
    buildLibraryUrl(props.scope, {
      articleId: props.row.id,
      unreadOnly: props.unreadOnly,
    });
  const html = (): string | undefined =>
    props.row.description ?? props.row.content;

  const onClick = (event: MouseEvent): void => {
    event.preventDefault();
    if (!isPlainPrimaryClick(event)) {
      openInNewTab(props.row.url);

      return;
    }

    props.onNavigate(href());
  };

  return (
    <div
      class="group/row px-2 py-0.5 animate-fade-in"
      data-read={props.row.read ? '' : undefined}
    >
      <div
        class={[
          'group relative flex items-start gap-1 rounded-box py-2.5 pr-3 pl-1 transition-colors',
          props.active
            ? 'bg-neutral text-neutral-content'
            : 'hover:bg-base-200',
        ]}
      >
        <ReadToggle
          row={props.row}
          active={props.active}
          hasMeta={hasSourceMeta(props.scope, props.row)}
        />
        <a
          href={href()}
          class="flex min-w-0 flex-1 flex-col gap-1 rounded-field focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          onClick={onClick}
          onAuxClick={(event) => {
            if (event.button === 1) {
              event.preventDefault();
              openInNewTab(props.row.url);
            }
          }}
        >
          <RowSourceMeta row={props.row} scope={props.scope} />
          <RowTitle row={props.row} />
          <RowSummary html={html()} />
        </a>
      </div>
    </div>
  );
}

function RowSummary(props: { html: string | undefined }): JSX.Element {
  const text = (): string => htmlToPlainText(props.html);

  return (
    <Show when={text()}>
      {(summary) => (
        <span class="line-clamp-3 text-xs leading-relaxed opacity-60">
          {summary()}
        </span>
      )}
    </Show>
  );
}

function isGroupedScope(scope: LibraryScope): boolean {
  return scope.kind === 'all' || scope.kind === 'folder';
}

function hasSourceMeta(scope: LibraryScope, row: LibraryArticle): boolean {
  return !isGroupedScope(scope) || Boolean(row.publishedAt);
}

function RowSourceMeta(props: {
  row: LibraryArticle;
  scope: LibraryScope;
}): JSX.Element {
  const grouped = (): boolean => isGroupedScope(props.scope);
  return (
    <Show when={hasSourceMeta(props.scope, props.row)}>
      <span class="flex w-full items-center justify-between gap-2 text-xs opacity-65">
        <span class="flex min-w-0 flex-1 items-center gap-1.5">
          <Show when={!grouped()}>
            <Show when={props.scope.kind !== 'feed'}>
              <SiteIcon
                srcs={articleSource(props.row).iconSrcs}
                fallback="rss"
                size={14}
              />
            </Show>
            <span class="min-w-0 flex-1 truncate">
              {articleSource(props.row).title}
            </span>
          </Show>
        </span>
        <Show when={props.row.publishedAt}>
          {(publishedAt) => (
            <time class="shrink-0 tabular-nums" datetime={publishedAt()}>
              {formatRelativeTime(publishedAt(), locale(), now())}
            </time>
          )}
        </Show>
      </span>
    </Show>
  );
}

function RowTitle(props: { row: LibraryArticle }): JSX.Element {
  return (
    <span class="line-clamp-3 text-[0.9375rem] leading-snug font-semibold group-data-[read]/row:font-normal group-data-[read]/row:opacity-60">
      {props.row.title}
    </span>
  );
}

/**
 * Unread rows show a solid dot; read rows show a hollow circle only while the row
 * is hovered or the button has keyboard focus.
 */
function ReadToggle(props: {
  row: LibraryArticle;
  active: boolean;
  hasMeta: boolean;
}): JSX.Element {
  const label = (): string => t('library.readToggle');

  return (
    <button
      type="button"
      class={[
        'group/toggle flex size-5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-base-content/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary pointer-coarse:size-8',
        props.hasMeta
          ? 'mt-6 pointer-coarse:mt-4.5'
          : 'mt-0 pointer-coarse:-mt-1.5',
      ]}
      aria-pressed={props.row.read ? 'true' : 'false'}
      aria-label={label()}
      title={label()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void toggleArticleRead(props.row.id, !props.row.read);
      }}
    >
      <span
        class={[
          'size-2 rounded-full border border-current bg-current group-data-[read]/row:bg-transparent group-data-[read]/row:text-current group-data-[read]/row:opacity-0 group-data-[read]/row:group-hover:opacity-50 group-data-[read]/row:group-focus-visible/toggle:opacity-50 group-data-[read]/row:pointer-coarse:opacity-50',
          { 'text-primary': !props.active },
        ]}
        aria-hidden="true"
      />
    </button>
  );
}
