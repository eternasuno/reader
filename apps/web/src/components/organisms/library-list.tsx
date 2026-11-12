import { Show } from 'solid-js';
import type { Article, Feed, Scope } from '../../lib/library';
import {
  isBusy,
  type LibraryModel,
  unreadCount,
} from '../../pages/library-model';
import { Button } from '../atoms/button';
import { LibraryEntry } from '../molecules/library-entry';
import { LibraryToolbar } from '../molecules/library-toolbar';
import { VirtualScroller } from '../molecules/virtual-scroller';

const emptyCopy = (
  unreadOnly: boolean,
  scope: Scope
): { readonly title: string; readonly hint: string } => {
  if (unreadOnly)
    return { title: '没有未读文章', hint: '所有文章都已读过了。' };

  return scope.kind === 'later'
    ? {
        title: '留一篇，慢慢读',
        hint: '保存感兴趣的文章链接，在这里专注阅读。',
      }
    : {
        title: '从一个订阅源开始',
        hint: '添加 RSS 订阅，让新的文章汇集到这里。',
      };
};

const ListStatus = (props: {
  readonly title: string;
  readonly hint: string;
  readonly action: string | undefined;
  readonly onAction: () => void;
}) => (
  <div class="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-12 text-center">
    <div class="max-w-xs">
      <h3 class="text-lg font-medium text-balance">{props.title}</h3>
      <p class="mt-3 text-sm leading-relaxed text-pretty text-base-content/65">
        {props.hint}
      </p>
      <Show when={props.action}>
        {(action) => (
          <Button
            variant="solid"
            class="btn btn-sm btn-primary mt-6 pointer-coarse:min-h-11"
            onClick={props.onAction}
          >
            {action()}
          </Button>
        )}
      </Show>
    </div>
  </div>
);

const ListError = (props: {
  readonly message: string;
  readonly onRetry: () => void;
}) => (
  <div
    role="alert"
    class="flex shrink-0 items-center gap-3 border-b border-base-300 bg-base-100 px-4 py-2 text-xs text-error"
  >
    <span class="min-w-0 flex-1">{props.message}</span>
    <Button
      type="button"
      class="btn btn-sm pointer-coarse:min-h-11"
      onClick={props.onRetry}
    >
      重试
    </Button>
  </div>
);

const ListLoading = () => (
  <div
    role="status"
    class="flex min-h-0 flex-1 items-center justify-center gap-3 text-sm text-base-content/60"
  >
    <span class="loading loading-spinner loading-sm" aria-hidden="true" />
    正在加载文章…
  </div>
);

const ListEmpty = (props: {
  readonly model: LibraryModel;
  readonly onAdd: () => void;
}) => {
  const state = () => props.model.state();
  const copy = () =>
    state().error === undefined
      ? emptyCopy(state().unreadOnly, state().scope)
      : { title: '暂时无法加载文章', hint: '请点击上方重试。' };
  const action = () => {
    if (state().error !== undefined) return undefined;

    if (state().unreadOnly) return '查看全部文章';

    return state().scope.kind === 'later' ? '新增文章链接' : undefined;
  };
  const onAction = () => {
    if (state().unreadOnly) void props.model.setFilter(false);
    else props.onAdd();
  };

  return (
    <ListStatus
      title={copy().title}
      hint={copy().hint}
      action={action()}
      onAction={onAction}
    />
  );
};

const ListBody = (props: {
  readonly model: LibraryModel;
  readonly onOpen: (article: Article) => void;
  readonly onAdd: () => void;
}) => {
  const state = () => props.model.state();
  const empty = () => state().initialized && state().items.length === 0;
  const loading = () => !state().initialized && state().loading;
  const retry = () => {
    if (state().initialized) void props.model.loadMore();
    else void props.model.refresh();
  };

  return (
    <>
      <Show when={state().error}>
        {(message) => <ListError message={message()} onRetry={retry} />}
      </Show>
      <Show
        when={!empty()}
        fallback={<ListEmpty model={props.model} onAdd={props.onAdd} />}
      >
        <Show when={!loading()} fallback={<ListLoading />}>
          <VirtualScroller
            items={state().items}
            revision={state().items.length}
            getKey={(item) => item.id}
            estimateSize={124}
            onEndReached={() => void props.model.loadMore()}
          >
            {(item) => (
              <LibraryEntry
                article={item}
                feeds={state().feeds}
                selected={state().selected?.id === item.id}
                pending={state().pending.has(item.id)}
                onOpen={props.onOpen}
                onToggleRead={(article) => void props.model.toggleRead(article)}
              />
            )}
          </VirtualScroller>
        </Show>
      </Show>
    </>
  );
};

export const LibraryList = (props: {
  readonly model: LibraryModel;
  readonly title: string;
  readonly onOpen: (article: Article) => void;
  readonly onAdd: () => void;
  readonly onUnsubscribe: (feed: Feed) => void;
}) => {
  const state = () => props.model.state();

  return (
    <div class="flex h-full min-h-0 flex-col">
      <LibraryToolbar
        title={props.title}
        unread={unreadCount(state().counts, state().scope)}
        unreadOnly={state().unreadOnly}
        canAddArticle={state().scope.kind === 'later'}
        currentFeed={state().feeds.find((feed) => {
          const scope = state().scope;

          return scope.kind === 'feeds' && scope.feedId === feed.id;
        })}
        onUnsubscribe={props.onUnsubscribe}
        busy={isBusy(state())}
        loadedUnread={state().items.some((item) => !item.read)}
        onFilter={(unreadOnly) => void props.model.setFilter(unreadOnly)}
        onMarkLoaded={() => void props.model.markLoaded()}
        onMarkAll={() => void props.model.markAll()}
        onRefresh={() => void props.model.refresh()}
        onAdd={props.onAdd}
      />
      <ListBody model={props.model} onOpen={props.onOpen} onAdd={props.onAdd} />
    </div>
  );
};
