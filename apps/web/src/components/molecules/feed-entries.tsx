import type { FeedArticle } from '@reader/api';
import { A } from '@solidjs/router';
import { Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { For, Show } from 'solid-js';
import type { FeedReaderModel } from '../organisms/feed-reader';
import { ReadingPager } from '../organisms/reading-pager';
import { EntryTime } from './list-toolbar';

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
  <div class="mt-3 flex gap-4 text-xs">
    <A class="link" href={`/read/feed/${props.item.key}`}>
      站内阅读
    </A>
    <button
      class="link"
      type="button"
      disabled={props.model.pending()}
      onClick={() =>
        void props.model.run({
          _tag: 'Mark',
          key: props.item.key,
          read: !props.item.read,
        })
      }
    >
      {props.item.read ? '标为未读' : '标为已读'}
    </button>
    <button
      class="link"
      type="button"
      disabled={props.model.pending()}
      onClick={() => void props.model.save(props.item.key)}
    >
      保存到稍后读
    </button>
  </div>
);

const FeedThumbnail = (props: { readonly description: string | undefined }) => (
  <Show when={props.description}>
    {(description) => {
      // Parse inertly; never attach feed markup or copy its attributes.
      const document = new DOMParser().parseFromString(
        description(),
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
          /* Invalid image addresses are omitted. */
        }
      }
      return (
        <Show when={thumbnail}>
          {(url) => (
            <img
              class="entry-thumbnail"
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
      <a
        class="entry-title text-base font-medium leading-relaxed hover:underline"
        href={props.item.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {props.item.title}
      </a>
    }
  >
    <a
      class="entry-title text-base font-medium leading-relaxed hover:underline"
      href={`/read/feed/${props.item.key}`}
      aria-current={props.selected ? true : undefined}
      onClick={(event) => selectEntry(event, props.onSelect, props.item)}
    >
      {props.item.title}
    </a>
  </Show>
);

const FeedEntry = (props: {
  readonly model: FeedReaderModel;
  readonly item: FeedArticle;
  readonly onSelect?: ((item: FeedArticle) => void) | undefined;
  readonly selected?: boolean | undefined;
}) => {
  const integrated = () => props.onSelect !== undefined;

  return (
    <article
      class="feed-entry reading-entry"
      classList={{ 'entry-unread': !props.item.read }}
    >
      <p class="entry-source">
        <span>
          {Option.getOrUndefined(
            AsyncResult.value(props.model.feeds())
          )?.items.find((feed) => feed.key === props.item.feedKey)?.title ??
            new URL(props.item.url).hostname}
        </span>
        <EntryTime value={props.item.publishedAt} />
      </p>
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
    </article>
  );
};

const FeedArticlesBody = (props: {
  readonly model: FeedReaderModel;
  readonly items: readonly FeedArticle[] | undefined;
  readonly hasMore: boolean | undefined;
  readonly onSelect?: ((item: FeedArticle) => void) | undefined;
  readonly selectedKey?: string | undefined;
}) => (
  <>
    <For
      each={props.items}
      fallback={
        <p class="py-12 text-sm text-base-content/50">
          这里还没有{props.model.query().read ? '已读' : '未读'}文章。
        </p>
      }
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
    </For>
    <ReadingPager
      page={props.model.query().page}
      pending={props.model.pending()}
      hasMore={props.hasMore}
      onPrevious={() =>
        props.model.setQuery((q) => ({ ...q, page: q.page - 1 }))
      }
      onNext={() => props.model.setQuery((q) => ({ ...q, page: q.page + 1 }))}
    />
  </>
);

const FeedArticlesError = (props: { readonly model: FeedReaderModel }) => (
  <p class="py-10" role="alert">
    文章加载失败。
    <button
      class="link ml-2"
      type="button"
      onClick={props.model.reloadArticles}
    >
      重试
    </button>
  </p>
);

export const FeedArticles = (props: {
  readonly model: FeedReaderModel;
  readonly onSelect?: ((item: FeedArticle) => void) | undefined;
  readonly selectedKey?: string | undefined;
}) => {
  const result = () => props.model.articles();
  const page = () => Option.getOrUndefined(AsyncResult.value(result()));
  const ready = () =>
    page() !== undefined ||
    (!result().waiting && !AsyncResult.isInitial(result()));

  return (
    <section aria-label="RSS 文章">
      <Show
        when={!AsyncResult.isFailure(result())}
        fallback={<FeedArticlesError model={props.model} />}
      >
        <Show
          when={ready()}
          fallback={
            <p class="py-10" role="status">
              正在加载文章…
            </p>
          }
        >
          <FeedArticlesBody
            model={props.model}
            items={page()?.items}
            hasMore={page()?.hasMore}
            onSelect={props.onSelect}
            selectedKey={props.selectedKey}
          />
        </Show>
      </Show>
    </section>
  );
};
