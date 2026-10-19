import type { Feed } from '@reader/api';
import { Cause, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { For, Show } from 'solid-js';
import type { FeedReaderModel } from './feed-reader';

const errorMessage = (result: AsyncResult.AsyncResult<unknown, unknown>) => {
  if (!AsyncResult.isFailure(result)) {
    return '';
  }
  const error = Cause.squash(result.cause);
  return typeof error === 'object' &&
    error !== null &&
    'error' in error &&
    typeof error.error === 'string'
    ? error.error
    : '操作失败，请稍后重试';
};

export const FeedReadTabs = (props: { model: FeedReaderModel }) => (
  <div class="flex gap-4 text-sm">
    <button
      type="button"
      class={
        props.model.query().read
          ? 'text-base-content/40'
          : 'font-semibold underline underline-offset-8'
      }
      onClick={() =>
        props.model.setQuery((q) => ({ ...q, read: false, page: 0 }))
      }
    >
      未读
    </button>
    <button
      type="button"
      class={
        props.model.query().read
          ? 'font-semibold underline underline-offset-8'
          : 'text-base-content/40'
      }
      onClick={() =>
        props.model.setQuery((q) => ({ ...q, read: true, page: 0 }))
      }
    >
      已读
    </button>
  </div>
);

const FeedRow = (props: { model: FeedReaderModel; feed: Feed }) => {
  const stamp = () =>
    props.feed.updatedAt
      ? `更新于 ${new Date(props.feed.updatedAt).toLocaleString()}`
      : '等待更新';
  const confirmUnsubscribe = () => {
    if (
      window.confirm('取消订阅并删除该源的 RSS 文章？已保存的稍后读不会删除。')
    ) {
      void props.model.run({ _tag: 'Unsubscribe', key: props.feed.key });
    }
  };
  return (
    <div class="flex flex-wrap items-center justify-between gap-2 border-t border-base-200 py-2 first:border-t-0 first:pt-0 last:pb-0">
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm">{props.feed.title}</p>
        <p class="truncate text-xs text-base-content/50">{stamp()}</p>
        <Show when={props.feed.error}>
          <p class="mt-1 text-xs text-error" role="status">
            {props.feed.error}
          </p>
        </Show>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          disabled={props.model.pending()}
          onClick={() =>
            void props.model.run({ _tag: 'Refresh', key: props.feed.key })
          }
        >
          刷新
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          disabled={props.model.pending()}
          onClick={confirmUnsubscribe}
        >
          取消订阅
        </button>
      </div>
    </div>
  );
};

const FeedRows = (props: {
  model: FeedReaderModel;
  items: readonly Feed[];
}) => (
  <For
    each={props.items}
    fallback={
      <p class="py-3 text-sm text-base-content/50">
        尚未订阅。添加 RSS 或 Atom 地址开始阅读。
      </p>
    }
  >
    {(feed) => <FeedRow model={props.model} feed={feed} />}
  </For>
);

export const FeedSubscriptions = (props: { model: FeedReaderModel }) => {
  const items = () =>
    Option.getOrUndefined(AsyncResult.value(props.model.feeds()))?.items ?? [];
  const loading = () => props.model.feeds().waiting && items().length === 0;
  return (
    <section class="border-b border-base-300 py-4" aria-label="订阅源">
      <div class="mb-3 flex items-center justify-between gap-3">
        <h2 class="text-sm font-semibold tracking-tight">订阅源</h2>
        <span class="text-xs text-base-content/50">每 30 分钟自动更新</span>
      </div>
      <Show
        when={!AsyncResult.isFailure(props.model.feeds())}
        fallback={
          <p role="alert" class="py-3 text-sm text-error">
            订阅源加载失败。
            <button
              type="button"
              class="link ml-2"
              onClick={props.model.reloadFeeds}
            >
              重试
            </button>
          </p>
        }
      >
        <Show
          when={!loading()}
          fallback={
            <p role="status" class="py-3 text-sm text-base-content/50">
              正在加载订阅源…
            </p>
          }
        >
          <FeedRows model={props.model} items={items()} />
        </Show>
      </Show>
    </section>
  );
};

export const FeedSubscribeForm = (props: { model: FeedReaderModel }) => (
  <form
    class="flex items-center gap-2 pt-2"
    onSubmit={(event) => {
      event.preventDefault();
      if (!props.model.pending()) {
        void props.model.subscribe(event.currentTarget);
      }
    }}
  >
    <label class="sr-only" for="feed-url">
      订阅地址
    </label>
    <input
      class="input input-bordered min-w-0 flex-1"
      id="feed-url"
      name="url"
      type="url"
      required
      maxLength={4096}
      placeholder="RSS / Atom 订阅地址"
      aria-label="订阅地址"
      disabled={props.model.pending()}
    />
    <button
      class="btn btn-neutral"
      type="submit"
      disabled={props.model.pending()}
      aria-busy={props.model.pending()}
    >
      {props.model.pending() ? '处理中…' : '订阅'}
    </button>
  </form>
);

export const FeedManagement = (props: { model: FeedReaderModel }) => {
  const message = () =>
    errorMessage(props.model.mutation()) || props.model.notice();
  const failed = () => errorMessage(props.model.mutation()) !== '';
  return (
    <section aria-label="订阅管理" class="py-2">
      <h2 class="text-lg font-semibold tracking-tight">订阅管理</h2>
      <p class="mt-2 text-sm text-base-content/60">
        添加 RSS 或 Atom 地址，订阅源每 30 分钟自动更新。
      </p>
      <FeedSubscribeForm model={props.model} />
      <p
        class="mt-2 min-h-5 text-sm"
        classList={{ 'text-error': failed(), 'text-success': !failed() }}
        role={failed() ? 'alert' : 'status'}
      >
        {message()}
      </p>
      <FeedSubscriptions model={props.model} />
    </section>
  );
};
