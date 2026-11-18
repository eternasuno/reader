import { Show } from 'solid-js';
import { feedById } from '../feed';
import { Button } from '../ui/button';
import { ReadStatusIcon } from '../ui/icon';
import { relativeTime } from '../ui/relative-time';
import { copy } from './messages';
import { currentScope, openArticle, unreadFilter } from './route';
import { type Article, scopePath } from './scope';

export type ArticleRowProps = {
  readonly article: Article;
  /** Whether this row's article is the open one (LIB-ROW-4). */
  readonly selected: boolean;
  readonly onToggleRead: (article: Article) => void;
};

const plainText = (html: string): string => {
  const parsed = new DOMParser().parseFromString(html, 'text/html');

  return (parsed.body.textContent ?? '').replace(/\s+/g, ' ').trim();
};

/** The source: the feed's title, else the address's host, else `稍后阅读` (LIB-ROW-1). */
const sourceOf = (article: Article): string => {
  if (article.kind === 'feed-item') {
    const feed = feedById(article.item.feedId);

    if (feed !== undefined) return feed.title;
  }

  return new URL(article.item.url).hostname || copy.laterName;
};

const summaryOf = (article: Article): string =>
  article.item.description === undefined
    ? ''
    : plainText(article.item.description);

const titleClass =
  "line-clamp-3 wrap-anywhere text-sm font-[450] leading-[1.55] text-base-content after:absolute after:inset-0 after:content-[''] group-data-[read=false]:font-semibold group-data-[read=true]:text-base-content/70";

const surfaceClass =
  'group relative flow-root -mx-6 border-b border-base-300/50 px-7 py-5 hover:bg-base-content/5 pointer-coarse:pl-12 data-[selected=true]:bg-neutral/30 data-[selected=true]:shadow-[inset_2px_0_var(--color-primary)]';

/** A modified click or a middle click is the browser's (LIB-ROW-3). */
const followLink = (event: MouseEvent, article: Article): void => {
  if (
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  event.preventDefault();
  openArticle(article.item.id);
};

const ReadControl = (props: ArticleRowProps) => {
  const read = () => props.article.item.read;

  return (
    <Button
      type="button"
      class={`absolute top-8 left-0 z-2 grid size-7 cursor-pointer place-items-center bg-transparent text-base-content pointer-coarse:top-9 pointer-coarse:size-11 [&]:rounded-full! ${read() ? 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100' : ''}`}
      aria-label={
        read()
          ? copy.rowReadLabel(props.article.item.title)
          : copy.rowUnreadLabel(props.article.item.title)
      }
      aria-pressed={read()}
      title={read() ? copy.rowReadTitle : copy.rowUnreadTitle}
      onClick={() => props.onToggleRead(props.article)}
    >
      <ReadStatusIcon read={read()} class="size-4" />
    </Button>
  );
};

/** One row of the article list (LIB-ROW): source, time, title, summary, control. */
export const ArticleRow = (props: ArticleRowProps) => {
  const href = () =>
    scopePath(currentScope(), {
      unread: unreadFilter(),
      articleId: props.article.item.id,
    });

  return (
    <article
      class={surfaceClass}
      data-read={props.article.item.read}
      data-selected={props.selected}
    >
      <p class="mb-1 flex items-center justify-between gap-3 text-xs leading-[1.6] text-base-content/60">
        <span class="min-w-0 truncate">{sourceOf(props.article)}</span>
        <Show when={props.article.item.publishedAt}>
          {(time) => (
            <time
              class="shrink-0"
              datetime={time()}
              title={new Date(time()).toLocaleString()}
            >
              {relativeTime(time())}
            </time>
          )}
        </Show>
      </p>
      <ReadControl
        article={props.article}
        selected={props.selected}
        onToggleRead={props.onToggleRead}
      />
      <a
        class={titleClass}
        href={href()}
        aria-current={props.selected ? true : undefined}
        onClick={(event) => followLink(event, props.article)}
      >
        {props.article.item.title}
      </a>
      <Show when={summaryOf(props.article)}>
        {(text) => (
          <p class="mt-2 line-clamp-2 text-sm leading-relaxed text-base-content/60">
            {text()}
          </p>
        )}
      </Show>
    </article>
  );
};
