import {
  useAtom,
  useAtomRefresh,
  useAtomSet,
  useAtomValue,
} from '@effect/atom-solid/Hooks';
import { Cause, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { createEffect, Show, untrack } from 'solid-js';
import { makeReadingAtoms, type ReadingLink } from '../../lib/links';
import { Button } from '../atoms/button';
import { ListToolbar } from '../molecules/list-toolbar';
import {
  createReadStatusProjection,
  publishReadStatus,
  useReaderDataRefresh,
} from './reader-status';
import { ReadingAddForm } from './reading-add-form';
import { ReadingEntries } from './reading-entries';
import { ReadingPager } from './reading-pager';

type ReadingListProps = {
  readonly onItems?: ((items: readonly ReadingLink[]) => void) | undefined;
  readonly onSelect?: ((item: ReadingLink) => void) | undefined;
  readonly selectedKey?: string | undefined;
};

const useReadingList = () => {
  const atoms = makeReadingAtoms();
  const [query, setQuery] = useAtom(() => atoms.query);
  const result = useAtomValue(() => atoms.page);
  const page = () => Option.getOrUndefined(AsyncResult.value(result()));
  const items = createReadStatusProjection('link', () => page()?.items);
  const mutation = useAtomValue(() => atoms.command);
  const run = useAtomSet(() => atoms.command, { mode: 'promiseExit' });
  const refresh = useAtomRefresh(() => atoms.page);
  const pending = () => mutation().waiting;
  useReaderDataRefresh(refresh);
  const add = async (url: string, form: HTMLFormElement) => {
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
  const toggle = (item: ReadingLink) => {
    if (pending()) return;

    const read = !item.read;
    void run({ _tag: 'Mark', key: item.key, read }).then((exit) => {
      publishReadStatus(exit, { kind: 'link', key: item.key, read });
    });
  };
  const remove = (item: ReadingLink) => {
    if (!pending() && window.confirm('确定删除这个链接？此操作无法撤销。')) {
      void run({ _tag: 'Delete', key: item.key });
    }
  };

  return {
    query,
    setQuery,
    result,
    page,
    items,
    mutation,
    pending,
    add,
    toggle,
    remove,
    refresh,
  };
};

type ReadingModel = ReturnType<typeof useReadingList>;

const mutationError = (
  result: AsyncResult.AsyncResult<unknown, unknown>
): string => {
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

type ReadingContentProps = {
  readonly model: ReadingModel;
  readonly onSelect?: ((item: ReadingLink) => void) | undefined;
  readonly selectedKey?: string | undefined;
};

const ReadingContent = (props: ReadingContentProps) => {
  const result = () => props.model.result();
  const page = () => props.model.page();
  const hasCached = () => page() !== undefined;

  return (
    <Show
      when={!AsyncResult.isFailure(result())}
      fallback={
        <p class="py-12" role="alert">
          暂时无法加载清单。
          <Button class="link ml-3" type="button" onClick={props.model.refresh}>
            重试
          </Button>
        </p>
      }
    >
      <Show
        when={
          hasCached() || (!result().waiting && !AsyncResult.isInitial(result()))
        }
        fallback={
          <p class="py-12 text-sm" role="status">
            正在加载清单…
          </p>
        }
      >
        <ReadingEntries
          read={props.model.query().read}
          items={props.model.items()}
          pending={props.model.pending()}
          onToggle={props.model.toggle}
          onDelete={props.model.remove}
          onSelect={props.onSelect}
          selectedKey={props.selectedKey}
        />
        <ReadingPager
          page={props.model.query().page}
          pending={props.model.pending()}
          hasMore={page()?.hasMore}
          onPrevious={() =>
            props.model.setQuery((q) => ({ ...q, page: q.page - 1 }))
          }
          onNext={() =>
            props.model.setQuery((q) => ({ ...q, page: q.page + 1 }))
          }
        />
      </Show>
    </Show>
  );
};

export const ReadingList = (props: ReadingListProps) => {
  const model = useReadingList();
  const loaded = () => model.page()?.items;
  let published: readonly ReadingLink[] | undefined;
  createEffect(() => {
    const items = model.items();
    if (items && items !== published) {
      published = items;
      untrack(() => props.onItems?.(items));
    }
  });
  let addDialog!: HTMLDialogElement;
  const openAddDialog = () => {
    if (!addDialog.open) {
      addDialog.showModal();
    }
  };
  const handleAdd = (url: string, form: HTMLFormElement) => {
    void model.add(url, form).then((added) => {
      if (added) {
        addDialog.close();
      }
    });
  };

  return (
    <>
      <ListToolbar
        title="稍后阅读"
        count={loaded()?.length}
        read={model.query().read}
        pending={model.pending()}
        onAdd={openAddDialog}
        onRefresh={model.refresh}
        onFilter={(read) => model.setQuery({ read, page: 0 })}
      />
      <dialog
        ref={(element) => {
          addDialog = element;
        }}
        aria-label="添加链接"
      >
        <form method="dialog" class="flex justify-end">
          <Button type="submit" class="btn btn-ghost btn-sm">
            关闭
          </Button>
        </form>
        <ReadingAddForm
          pending={model.pending()}
          error={mutationError(model.mutation())}
          onAdd={handleAdd}
        />
      </dialog>
      <ReadingContent
        model={model}
        onSelect={props.onSelect}
        selectedKey={props.selectedKey}
      />
    </>
  );
};
