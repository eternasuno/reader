import {
  useAtom,
  useAtomMount,
  useAtomRefresh,
  useAtomSet,
  useAtomValue,
} from '@effect/atom-solid/Hooks';
import type { Exit } from 'effect';
import { Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { createEffect, createSignal, on, untrack } from 'solid-js';
import { resultError } from '../../lib/errors';
import type { LinkCommand, ReadingLink } from '../../lib/links';
import type { MarkLoadedResult } from '../../lib/mark-loaded';
import { useInfiniteLoader } from '../../pages/infinite-loader';
import { useWorkspaceData } from '../../pages/workspace-state';
import { Dialog } from '../molecules/dialog';
import { ListToolbar } from '../molecules/list-toolbar';
import {
  createReadStatusProjection,
  hasUnread,
  publishBulkReadStatus,
  publishReadStatus,
  publishReadStatuses,
  unreadKeys,
  useReaderDataRefresh,
} from './reader-status';
import { ReadingAddForm } from './reading-add-form';
import { ReadingEntries } from './reading-entries';

type RunLink = (
  input: LinkCommand
) => Promise<Exit.Exit<MarkLoadedResult | undefined, unknown>>;

const addReadingLink = async (
  run: RunLink,
  pending: () => boolean,
  url: string,
  form: HTMLFormElement
) => {
  if (pending()) {
    return false;
  }

  const exit = await run({ _tag: 'Add', url });

  if (exit._tag === 'Success') {
    form.reset();
    return true;
  }

  return false;
};

const toggleReadingLink = (
  run: RunLink,
  pending: () => boolean,
  item: ReadingLink
) => {
  if (pending()) return;

  const read = !item.read;
  void run({ _tag: 'Mark', key: item.key, read }).then((exit) => {
    publishReadStatus(exit, { kind: 'link', key: item.key, read });
  });
};

const removeReadingLink = (
  run: RunLink,
  pending: () => boolean,
  item: ReadingLink
) => {
  if (!pending() && window.confirm('确定删除这个链接？此操作无法撤销。')) {
    void run({ _tag: 'Delete', key: item.key });
  }
};

const markAllReadingLinks = async (
  run: RunLink,
  pending: () => boolean,
  items: readonly ReadingLink[]
) => {
  if (pending()) return;

  const exit = await run({ _tag: 'MarkAll' });
  if (exit._tag === 'Success') {
    publishBulkReadStatus(exit, {
      kind: 'link',
      keys: items.map((item) => item.key),
      read: true,
      scope: { kind: 'links' },
    });
  }
};

const useReadingSource = () => {
  const data = useWorkspaceData();
  const [filter, setFilter] = useAtom(() => data.reading.query);
  const state = useAtomValue(() => data.reading.state);
  const unread = useAtomValue(() => data.reading.unread);
  const mutation = useAtomValue(() => data.reading.command);
  const run = useAtomSet(() => data.reading.command, { mode: 'promiseExit' });
  const refreshUnread = useAtomRefresh(() => data.reading.unread);
  const load = useAtomSet(() => data.reading.load, { mode: 'promiseExit' });
  useAtomMount(() => data.reading.load);
  const items = createReadStatusProjection('link', () => state().items);
  const pending = () => mutation().waiting;
  const unreadCount = () =>
    Option.getOrUndefined(AsyncResult.value(unread()))?.count;
  const loader = useInfiniteLoader(state, pending, (reset) => load({ reset }));

  return {
    data,
    filter,
    setFilter,
    state,
    unread,
    mutation,
    run,
    refreshUnread,
    items,
    pending,
    unreadCount,
    ...loader,
  };
};

const useReadingReset = (
  source: ReturnType<typeof useReadingSource>,
  active: () => boolean
) => {
  createEffect(
    on(
      () => [source.data.onlyUnread(), active()] as const,
      ([onlyUnread, isActive]) => {
        source.setFilter(onlyUnread);
        if (isActive) source.reload();
      }
    )
  );
  useReaderDataRefresh(() => {
    if (active()) source.reload();
  });
};

const useReadingActions = (source: ReturnType<typeof useReadingSource>) => {
  const [markError, setMarkError] = createSignal('');
  const add = (url: string, form: HTMLFormElement) =>
    addReadingLink(source.run, source.pending, url, form);
  const toggle = (item: ReadingLink) =>
    toggleReadingLink(source.run, source.pending, item);
  const remove = (item: ReadingLink) =>
    removeReadingLink(source.run, source.pending, item);
  const markAll = () =>
    markAllReadingLinks(source.run, source.pending, source.items() ?? []);
  const markLoaded = async () => {
    if (source.pending()) return;

    const keys = unreadKeys(source.items());
    if (keys.length === 0) return;

    setMarkError('');
    const exit = await source.run({
      _tag: 'MarkLoaded',
      keys,
      generation: source.state().generation,
    });
    if (exit._tag === 'Success' && exit.value) {
      publishReadStatuses(exit, 'link', exit.value.keys);
      setMarkError(exit.value.error);
    }
  };
  const refresh = () => {
    if (source.pending()) return;

    source.refreshUnread();
    source.reload();
  };

  return { markError, add, toggle, remove, markAll, markLoaded, refresh };
};

const useReadingList = (active: () => boolean) => {
  const source = useReadingSource();
  useReadingReset(source, active);

  return { ...source, ...useReadingActions(source) };
};

type ReadingListProps = {
  readonly active?: boolean | undefined;
  readonly onItems?: ((items: readonly ReadingLink[]) => void) | undefined;
  readonly onSelect?: ((item: ReadingLink) => void) | undefined;
  readonly selectedKey?: string | undefined;
};

type ReadingModel = ReturnType<typeof useReadingList>;

const ReadingToolbar = (props: { readonly model: ReadingModel }) => {
  const [addOpen, setAddOpen] = createSignal(false);
  const handleAdd = (url: string, form: HTMLFormElement) => {
    void props.model.add(url, form).then((added) => {
      if (added) {
        setAddOpen(false);
      }
    });
  };

  return (
    <>
      <ListToolbar
        title="稍后阅读"
        unread={props.model.unreadCount()}
        loadedUnread={hasUnread(props.model.items())}
        onlyUnread={props.model.filter()}
        pending={props.model.pending()}
        error={resultError(props.model.mutation()) || props.model.markError()}
        onRefresh={props.model.refresh}
        onAdd={() => setAddOpen(true)}
        onMarkAll={() => void props.model.markAll()}
        onMarkLoaded={() => void props.model.markLoaded()}
        onOnlyUnreadChange={props.model.data.setOnlyUnread}
      />
      <Dialog
        open={addOpen()}
        label="添加链接"
        onClose={() => setAddOpen(false)}
      >
        <ReadingAddForm
          pending={props.model.pending()}
          error={resultError(props.model.mutation())}
          onAdd={handleAdd}
        />
      </Dialog>
    </>
  );
};

const ReadingContent = (props: {
  readonly model: ReadingModel;
  readonly active: boolean;
  readonly onSelect?: ((item: ReadingLink) => void) | undefined;
  readonly selectedKey?: string | undefined;
}) => (
  <ReadingEntries
    onlyUnread={props.model.filter()}
    active={props.active}
    items={props.model.items()}
    state={props.model.state()}
    pending={props.model.pending()}
    onToggle={props.model.toggle}
    onDelete={props.model.remove}
    onLoadMore={props.model.loadMore}
    onRetry={props.model.retry}
    onSelect={props.onSelect}
    selectedKey={props.selectedKey}
  />
);

export const ReadingList = (props: ReadingListProps) => {
  const model = useReadingList(() => props.active ?? true);
  let published: readonly ReadingLink[] | undefined;
  createEffect(() => {
    const items = model.items();
    if (items && items !== published) {
      published = items;
      untrack(() => props.onItems?.(items));
    }
  });

  return (
    <div class="flex h-full min-h-0 flex-col">
      <ReadingToolbar model={model} />
      <ReadingContent
        model={model}
        active={props.active ?? true}
        onSelect={props.onSelect}
        selectedKey={props.selectedKey}
      />
    </div>
  );
};
