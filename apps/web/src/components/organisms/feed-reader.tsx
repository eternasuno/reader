import {
  useAtom,
  useAtomRefresh,
  useAtomSet,
  useAtomValue,
} from '@effect/atom-solid/Hooks';
import type { FeedArticle } from '@reader/api';
import { Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { createEffect, createSignal, For, Show, untrack } from 'solid-js';
import { makeFeedAtoms } from '../../lib/feeds';
import { FeedArticles } from '../molecules/feed-entries';
import { ListToolbar } from '../molecules/list-toolbar';
import { FeedManagement, FeedReadTabs } from './feed-subscriptions';
import {
  createReadStatusProjection,
  notifyReaderDataChanged,
  publishReadStatus,
  useReaderDataRefresh,
} from './reader-status';

const subscribeFeed = (
  run: (input: {
    readonly _tag: 'Subscribe';
    readonly url: string;
  }) => Promise<{ readonly _tag: string }>,
  setNotice: (value: string) => void,
  form: HTMLFormElement
) => {
  const url = String(new FormData(form).get('url') ?? '').trim();
  setNotice('');
  return run({ _tag: 'Subscribe', url }).then((exit) => {
    if (exit._tag === 'Success') {
      form.reset();
    }
  });
};

const saveFeedArticle = (
  run: (input: {
    readonly _tag: 'Save';
    readonly key: string;
  }) => Promise<{ readonly _tag: string }>,
  setNotice: (value: string) => void,
  key: string
) => {
  setNotice('');
  return run({ _tag: 'Save', key }).then((exit) => {
    if (exit._tag === 'Success') {
      setNotice('已保存到稍后读');
    }
  });
};

const useFeeds = () => {
  const atoms = makeFeedAtoms();
  const [query, setQuery] = useAtom(() => atoms.query);
  const feeds = useAtomValue(() => atoms.feeds);
  const articles = useAtomValue(() => atoms.articles);
  const page = () => Option.getOrUndefined(AsyncResult.value(articles()));
  const items = createReadStatusProjection('feed', () => page()?.items);
  const mutation = useAtomValue(() => atoms.command);
  const rawRun = useAtomSet(() => atoms.command, { mode: 'promiseExit' });
  const reloadFeeds = useAtomRefresh(() => atoms.feeds);
  const reloadArticles = useAtomRefresh(() => atoms.articles);
  useReaderDataRefresh(reloadFeeds, reloadArticles);
  const run = async (...args: Parameters<typeof rawRun>) => {
    const exit = await rawRun(...args);
    if (exit._tag === 'Success') {
      notifyReaderDataChanged();
    }
    return exit;
  };
  const mark = async (key: string, read: boolean) => {
    const exit = await rawRun({ _tag: 'Mark', key, read });
    publishReadStatus(exit, { kind: 'feed', key, read });

    return exit;
  };
  const [notice, setNotice] = createSignal('');
  const subscribe = (form: HTMLFormElement) =>
    subscribeFeed(run, setNotice, form);
  const save = (key: string) => saveFeedArticle(run, setNotice, key);

  return {
    query,
    setQuery,
    feeds,
    articles,
    page,
    items,
    mutation,
    run,
    mark,
    reloadFeeds,
    reloadArticles,
    subscribe,
    save,
    notice,
    pending: () => mutation().waiting,
  };
};

export type FeedReaderModel = ReturnType<typeof useFeeds>;

export type FeedReaderProps = {
  readonly onItems?: ((items: readonly FeedArticle[]) => void) | undefined;
  readonly onSelect?: ((item: FeedArticle) => void) | undefined;
  readonly selectedKey?: string | undefined;
  readonly feedKey?: string | undefined;
  readonly management?: boolean | undefined;
};

const useFeedReader = (props: FeedReaderProps) => {
  const model = useFeeds();
  const loaded = () => model.items();
  let published: readonly FeedArticle[] | undefined;
  createEffect(() => {
    const items = loaded();
    if (items && items !== published) {
      published = items;
      untrack(() => props.onItems?.(items));
    }
  });
  const feeds = () =>
    Option.getOrUndefined(AsyncResult.value(model.feeds()))?.items ?? [];
  const integrated = () => props.onSelect !== undefined;
  const managing = () => props.management === true;

  createEffect(() => {
    const next = props.feedKey;
    if (next === undefined) {
      return;
    }
    if (model.query().feedKey !== next) {
      model.setQuery((q) => ({ ...q, feedKey: next, page: 0 }));
    }
  });

  const feedTitle = () => {
    const key = props.feedKey ?? model.query().feedKey;
    if (!key) {
      return '订阅文章';
    }
    return feeds().find((feed) => feed.key === key)?.title ?? 'RSS';
  };

  return { model, loaded, feeds, integrated, managing, feedTitle };
};

export const FeedReader = (props: FeedReaderProps) => {
  const view = useFeedReader(props);

  return <FeedReaderContent view={view} props={props} />;
};

type FeedReaderView = ReturnType<typeof useFeedReader>;

const FeedReaderContent = (input: {
  readonly view: FeedReaderView;
  readonly props: FeedReaderProps;
}) => {
  const { model, loaded, integrated, managing, feedTitle } = input.view;
  const props = input.props;

  return (
    <Show
      when={managing()}
      fallback={
        <Show when={integrated()} fallback={<StandaloneFeeds model={model} />}>
          <ListToolbar
            title={feedTitle()}
            count={loaded()?.length}
            read={model.query().read}
            pending={model.pending()}
            onRefresh={model.reloadArticles}
            onRefreshFeed={
              (props.feedKey ?? model.query().feedKey)
                ? () => {
                    void model.run({
                      _tag: 'Refresh',
                      key: props.feedKey ?? model.query().feedKey,
                    });
                  }
                : undefined
            }
            onFilter={(read) =>
              model.setQuery((q) => ({ ...q, read, page: 0 }))
            }
          />
          <FeedArticles
            model={model}
            onSelect={props.onSelect}
            selectedKey={props.selectedKey}
          />
        </Show>
      }
    >
      <FeedManagement model={model} />
    </Show>
  );
};

const StandaloneFeeds = (props: { readonly model: FeedReaderModel }) => (
  <>
    <FeedManagement model={props.model} />
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-base-300 py-5">
      <select
        class="select w-auto max-w-full rounded-none"
        aria-label="筛选订阅源"
        value={props.model.query().feedKey}
        onChange={(event) =>
          props.model.setQuery((q) => ({
            ...q,
            feedKey: event.currentTarget.value,
            page: 0,
          }))
        }
      >
        <option value="">全部订阅源</option>
        <For
          each={
            Option.getOrUndefined(AsyncResult.value(props.model.feeds()))
              ?.items ?? []
          }
        >
          {(feed) => <option value={feed.key}>{feed.title}</option>}
        </For>
      </select>
      <FeedReadTabs model={props.model} />
    </div>
    <FeedArticles model={props.model} />
  </>
);
