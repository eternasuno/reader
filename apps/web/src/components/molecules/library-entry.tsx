import { Option } from 'effect';
import { createMemo, Show } from 'solid-js';
import type { Article, Feed } from '../../lib/library';
import {
  EntryMeta,
  EntryReadToggle,
  EntrySurface,
  EntryTitle,
} from './list-entry';

const plainText = (html: string): string => {
  const document = new DOMParser().parseFromString(html, 'text/html');

  return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
};

const hostOf = (value: string | undefined): string | undefined => {
  if (value === undefined || value === '') return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
};

const entrySource = (article: Article, feeds: readonly Feed[]): string => {
  const feedId = Option.getOrUndefined(article.feedId);
  const feed =
    feedId === undefined ? undefined : feeds.find((item) => item.id === feedId);

  return (
    feed?.title ?? hostOf(Option.getOrUndefined(article.url)) ?? '稍后阅读'
  );
};

const entryPath = (article: Article): string =>
  `/read/${Option.isNone(article.feedId) ? 'link' : 'feed'}/${encodeURIComponent(article.id)}`;

const openEntry = (
  event: MouseEvent,
  article: Article,
  onOpen: (article: Article) => void
) => {
  if (
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  )
    return;

  event.preventDefault();

  onOpen(article);
};

export const LibraryEntry = (props: {
  readonly article: Article;
  readonly feeds: readonly Feed[];
  readonly selected: boolean;
  readonly pending: boolean;
  readonly onOpen: (article: Article) => void;
  readonly onToggleRead: (article: Article) => void;
}) => {
  const description = createMemo(() =>
    Option.match(props.article.description, {
      onNone: () => '',
      onSome: plainText,
    })
  );

  return (
    <EntrySurface
      component="article"
      read={props.article.read}
      selected={props.selected}
    >
      <EntryMeta
        source={entrySource(props.article, props.feeds)}
        time={props.article.publishedAt}
      />
      <EntryReadToggle
        label={props.article.title}
        read={props.article.read}
        pending={props.pending}
        onToggle={() => props.onToggleRead(props.article)}
      />
      <EntryTitle
        href={entryPath(props.article)}
        current={props.selected}
        onClick={(event) => openEntry(event, props.article, props.onOpen)}
      >
        {props.article.title}
      </EntryTitle>
      <Show when={description()}>
        {(text) => (
          <p class="mt-2 line-clamp-2 text-sm leading-relaxed text-base-content/60">
            {text()}
          </p>
        )}
      </Show>
    </EntrySurface>
  );
};
