import type { FeedArticle } from '@reader/api';
import { A } from '@solidjs/router';
import { Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { Show } from 'solid-js';
import { Button } from '../atoms/button';
import { InfiniteEntries } from '../molecules/infinite-entries';
import type { FeedReaderModel } from '../organisms/feed-reader';
import {
  EntryMeta,
  EntryReadToggle,
  EntrySurface,
  EntryTitle,
} from './list-entry';

const selectEntry = (
  event: MouseEvent,
  onSelect: ((item: FeedArticle) => void) | undefined,
  item: FeedArticle
) => {
  if (!onSelect) {
    return;
  }

  if (event.defaultPrevented) {
    return;
  }

  if (event.button !== 0) {
    return;
  }

  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    return;
  }

  event.preventDefault();
  onSelect(item);
};

const FeedEntryActions = (props: {
  readonly model: FeedReaderModel;
  readonly item: FeedArticle;
}) => (
  <div class="relative z-1 mt-3 flex gap-4 text-xs">
    <A class="link" href={`/read/feed/${props.item.key}`}>
      站内阅读
    </A>
    <Button
      class="link"
      type="button"
      disabled={props.model.pending()}
      onClick={() => void props.model.mark(props.item.key, !props.item.read)}
    >
      {props.item.read ? '标为未读' : '标为已读'}
    </Button>
    <Button
      class="link"
      type="button"
      disabled={props.model.pending()}
      onClick={() => void props.model.save(props.item.key)}
    >
      保存到稍后读
    </Button>
  </div>
);

const FeedThumbnail = (props: { readonly description: string | undefined }) => (
  <Show keyed when={props.description}>
    {(description) => {
      const document = new DOMParser().parseFromString(
        description,
        'text/html'
      );
      document
        .querySelectorAll('script, style, iframe, object, template')
        .forEach((node) => {
          node.remove();
        });
      const source = document.querySelector('img')?.getAttribute('src');
      let thumbnail: string | undefined;
      if (source) {
        try {
          const url = new URL(source);
          if (url.protocol === 'https:' || url.protocol === 'http:')
            thumbnail = url.href;
        } catch {
          thumbnail = undefined;
        }
      }

      return (
        <Show when={thumbnail}>
          {(url) => (
            <img
              class="float-right mt-2 ml-3 h-14 w-16 rounded-sm object-cover"
              src={url()}
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
            />
          )}
        </Show>
      );
    }}
  </Show>
);

const FeedEntryTitle = (props: {
  readonly item: FeedArticle;
  readonly onSelect?: ((item: FeedArticle) => void) | undefined;
  readonly selected?: boolean | undefined;
}) => (
  <Show
    when={props.onSelect !== undefined}
    fallback={
      <EntryTitle
        href={props.item.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {props.item.title}
      </EntryTitle>
    }
  >
    <EntryTitle
      href={`/read/feed/${props.item.key}`}
      current={props.selected}
      onClick={(event) => selectEntry(event, props.onSelect, props.item)}
    >
      {props.item.title}
    </EntryTitle>
  </Show>
);

const FeedEntry = (props: {
  readonly model: FeedReaderModel;
  readonly item: FeedArticle;
  readonly onSelect?: ((item: FeedArticle) => void) | undefined;
  readonly selected?: boolean | undefined;
}) => {
  const integrated = () => props.onSelect !== undefined;
  const source = () =>
    Option.getOrUndefined(AsyncResult.value(props.model.feeds()))?.items.find(
      (feed) => feed.key === props.item.feedKey
    )?.title ?? new URL(props.item.url).hostname;

  return (
    <EntrySurface
      component="article"
      read={props.item.read}
      selected={props.selected}
    >
      <EntryMeta source={source()} time={props.item.publishedAt} />
      <EntryReadToggle
        label={props.item.title}
        read={props.item.read}
        pending={props.model.pending()}
        onToggle={() => void props.model.mark(props.item.key, !props.item.read)}
      />
      <FeedEntryTitle
        item={props.item}
        onSelect={props.onSelect}
        selected={props.selected}
      />
      <FeedThumbnail description={props.item.description} />
      <Show when={props.item.description}>
        {(description) => (
          <p class="mt-2 line-clamp-2 text-sm text-base-content/60">
            {
              new DOMParser().parseFromString(description(), 'text/html').body
                .textContent
            }
          </p>
        )}
      </Show>
      <Show when={!integrated()}>
        <FeedEntryActions model={props.model} item={props.item} />
      </Show>
    </EntrySurface>
  );
};

export const FeedArticles = (props: {
  readonly model: FeedReaderModel;
  readonly active?: boolean | undefined;
  readonly onSelect?: ((item: FeedArticle) => void) | undefined;
  readonly selectedKey?: string | undefined;
}) => {
  const state = () => props.model.articles();
  const items = () => props.model.items() ?? [];
  const onlyUnread = () => props.model.query().onlyUnread;

  return (
    <section class="flex min-h-0 flex-1 flex-col" aria-label="RSS 文章">
      <InfiniteEntries
        items={items()}
        state={state()}
        active={props.active ?? true}
        getKey={(item) => item.key}
        estimateSize={148}
        emptyTitle={onlyUnread() ? '没有未读文章' : '还没有文章'}
        emptyHint={
          onlyUnread()
            ? '取消「只显示未读」可以查看全部历史。'
            : '刷新订阅源后再来看看。'
        }
        onLoadMore={props.model.loadMore}
        onRetry={props.model.retry}
      >
        {(item) => (
          <FeedEntry
            model={props.model}
            item={item}
            onSelect={props.onSelect}
            selected={
              props.selectedKey !== undefined && props.selectedKey === item.key
            }
          />
        )}
      </InfiniteEntries>
    </section>
  );
};
