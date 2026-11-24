import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import { formatRelativeTime, locale, t } from '../i18n';
import {
  articleSource,
  buildLibraryUrl,
  htmlToPlainText,
  type LibraryArticle,
  type LibraryScope,
  saveFeedItemToLater,
  toggleArticleRead,
} from '../state';
import { Button, Icon } from '../ui';
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
 * time, title (3 lines), summary (3 lines), and top-right quick actions. Plain
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
    <div class="px-2 py-0.5">
      <div
        class={[
          'group relative flex items-start gap-1 rounded-box py-2.5 pr-3 pl-1 transition-colors',
          props.active
            ? 'bg-neutral text-neutral-content'
            : 'hover:bg-base-200',
        ]}
      >
        <ReadToggle row={props.row} active={props.active} />
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
        <RowQuickActions row={props.row} active={props.active} />
      </div>
    </div>
  );
}

function RowQuickActions(props: {
  row: LibraryArticle;
  active: boolean;
}): JSX.Element {
  return (
    <div
      class={[
        'absolute top-1.5 right-2 flex items-center gap-0.5 rounded-field p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100',
        props.active ? 'bg-neutral' : 'bg-base-100 group-hover:bg-base-200',
      ]}
    >
      <Show when={props.row.kind === 'feed'}>
        <Button
          variant="icon"
          size="sm"
          class="size-7 pointer-coarse:size-10"
          aria-label={String(t('reader.saveToLater'))}
          title={String(t('reader.saveToLater'))}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void saveFeedItemToLater(props.row.id);
          }}
        >
          <Icon name="bookmark" size={14} />
        </Button>
      </Show>
      <Button
        variant="icon"
        size="sm"
        class="size-7 pointer-coarse:size-10"
        aria-label={String(t('reader.openOriginal'))}
        title={String(t('reader.openOriginal'))}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openInNewTab(props.row.url);
        }}
      >
        <Icon name="external-link" size={14} />
      </Button>
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

function RowSourceMeta(props: {
  row: LibraryArticle;
  scope: LibraryScope;
}): JSX.Element {
  return (
    <span class="flex w-full items-center justify-between gap-2 text-xs opacity-65">
      <span class="flex min-w-0 flex-1 items-center gap-1.5">
        <Show when={props.scope.kind !== 'feed'}>
          <SiteIcon
            url={articleSource(props.row).url}
            fallback="rss"
            size={14}
          />
        </Show>
        <span class="min-w-0 flex-1 truncate">
          {articleSource(props.row).title}
        </span>
      </span>
      <Show when={props.row.publishedAt}>
        {(publishedAt) => (
          <time class="shrink-0 tabular-nums" datetime={publishedAt()}>
            {formatRelativeTime(publishedAt(), locale())}
          </time>
        )}
      </Show>
    </span>
  );
}

function RowTitle(props: { row: LibraryArticle }): JSX.Element {
  return (
    <span
      class={[
        'line-clamp-3 text-[0.9375rem] leading-snug',
        props.row.read ? 'opacity-60' : 'font-semibold',
      ]}
    >
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
}): JSX.Element {
  const label = (): string => String(t('library.readToggle'));

  return (
    <button
      type="button"
      class="group/toggle mt-6 flex size-5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-base-content/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary pointer-coarse:mt-4.5 pointer-coarse:size-8"
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
          'size-2 rounded-full border border-current',
          props.row.read
            ? 'opacity-0 group-hover:opacity-50 group-focus-visible/toggle:opacity-50 pointer-coarse:opacity-50'
            : ['bg-current', props.active ? '' : 'text-primary'],
        ]}
        aria-hidden="true"
      />
    </button>
  );
}
