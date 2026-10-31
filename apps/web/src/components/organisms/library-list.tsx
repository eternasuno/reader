import { Show } from 'solid-js';
import type { Article, Filter } from '../../lib/library';
import { type LibraryModel, unreadCount } from '../../pages/library-model';
import { Button } from '../atoms/button';
import { LibraryEntry } from '../molecules/library-entry';
import { LibraryToolbar } from '../molecules/library-toolbar';
import { VirtualScroller } from '../molecules/virtual-scroller';

const emptyCopy = (
  filter: Filter
): { readonly title: string; readonly hint: string } => {
  if (filter === 'unread')
    return { title: '没有未读文章', hint: '所有文章都已读过了。' };
  if (filter === 'read')
    return { title: '还没有已读文章', hint: '打开一篇文章后，会出现在这里。' };

  return { title: '这里还没有文章', hint: '订阅一个源，或稍后再来看看。' };
};

const ListStatus = (props: {
  readonly title: string;
  readonly hint: string;
}) => (
  <div class="grid min-h-0 flex-1 place-items-center px-6 py-16 text-center">
    <div>
      <p class="text-lg">{props.title}</p>
      <p class="mt-3 text-sm text-base-content/50">{props.hint}</p>
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
    <Button type="button" class="btn btn-xs" onClick={props.onRetry}>
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

const ListBody = (props: {
  readonly model: LibraryModel;
  readonly onOpen: (article: Article) => void;
}) => {
  const state = () => props.model.state();
  const empty = () => state().initialized && state().items.length === 0;
  const loading = () => !state().initialized && state().loading;
  const copy = () =>
    state().error === undefined
      ? emptyCopy(state().filter)
      : { title: '暂时无法加载文章', hint: '请点击上方重试。' };
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
        fallback={<ListStatus title={copy().title} hint={copy().hint} />}
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
}) => {
  const state = () => props.model.state();

  return (
    <div class="flex h-full min-h-0 flex-col">
      <LibraryToolbar
        title={props.title}
        unread={unreadCount(state().counts, state().scope)}
        filter={state().filter}
        busy={state().loading || state().pending.size > 0}
        loadedUnread={state().items.some((item) => !item.read)}
        onFilter={(filter) => void props.model.setFilter(filter)}
        onMarkLoaded={() => void props.model.markLoaded()}
        onMarkAll={() => void props.model.markAll()}
        onAdd={props.onAdd}
      />
      <ListBody model={props.model} onOpen={props.onOpen} />
    </div>
  );
};
