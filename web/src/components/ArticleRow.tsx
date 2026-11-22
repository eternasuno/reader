import type { JSX } from '@solidjs/web';
import { createSignal, Show } from 'solid-js';
import { formatRelativeTime, locale, t } from '../i18n';
import {
  articleSource,
  buildLibraryUrl,
  firstImageUrl,
  htmlToPlainText,
  type LibraryArticle,
  type LibraryScope,
  toggleArticleRead,
} from '../state';
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
 * time, title (3 lines), summary (2 lines), and an optional thumbnail. Plain
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
  const summary = (): string => htmlToPlainText(html());
  const thumbnail = (): string | null => firstImageUrl(html());
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
    <div class="px-2 py-0.5">
      <div
        class={[
          'group flex items-start gap-1 rounded-box py-2.5 pr-3 pl-1 transition-colors',
          props.active
            ? 'bg-neutral text-neutral-content'
            : 'hover:bg-base-200',
        ]}
      >
        <ReadToggle row={props.row} active={props.active} label={readLabel()} />
        <a
          href={href()}
          class="flex min-w-0 flex-1 gap-3 rounded-field focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          onClick={onClick}
          onAuxClick={onAuxClick}
        >
          <span class="flex min-w-0 flex-1 flex-col gap-1">
            <RowSourceMeta row={props.row} />
            <RowTitle row={props.row} />
            <Show when={summary()}>
              {(text) => (
                <span class="line-clamp-2 text-xs leading-relaxed opacity-60">
                  {text()}
                </span>
              )}
            </Show>
          </span>
          <Show when={thumbnail()} keyed>
            {(src) => <RowThumbnail src={src} />}
          </Show>
        </a>
      </div>
    </div>
  );
}

function RowSourceMeta(props: { row: LibraryArticle }): JSX.Element {
  return (
    <span class="flex items-center gap-1.5 text-xs opacity-70">
      <SiteIcon url={articleSource(props.row).url} fallback="rss" size={14} />
      <span class="min-w-0 flex-1 truncate">
        {articleSource(props.row).title}
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

/** Hides itself when the image fails, so broken thumbnails never leave a gap. */
function RowThumbnail(props: { src: string }): JSX.Element {
  const [failed, setFailed] = createSignal(false);

  return (
    <Show when={!failed()}>
      <img
        src={props.src}
        alt=""
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        class="mt-5 size-20 shrink-0 rounded-field bg-base-300 object-cover"
        onError={() => setFailed(true)}
      />
    </Show>
  );
}

/**
 * Unread rows show a solid dot; read rows show a hollow circle only while the row
 * is hovered or the button has keyboard focus.
 */
function ReadToggle(props: {
  row: LibraryArticle;
  active: boolean;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      class="group/toggle mt-6 flex size-5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-base-content/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
          'size-2 rounded-full border border-current',
          props.row.read
            ? 'opacity-0 group-hover:opacity-50 group-focus-visible/toggle:opacity-50'
            : ['bg-current', props.active ? '' : 'text-primary'],
        ]}
        aria-hidden="true"
      />
    </button>
  );
}
