import { useParams } from '@solidjs/router';
import { createSignal, Show } from 'solid-js';
import { readerError } from '../../lib/reader';
import { WebpageFrame } from '../molecules/article-frame';
import { ErrorToast, useErrorToast } from '../molecules/error-toast';
import {
  ReaderActions,
  ReaderSourceLink,
  ReaderTitle,
} from './article-reader-actions';
import { ReaderContent } from './article-reader-content';
import {
  makeDeleteHandler,
  makeExtractHandler,
  makeMarkHandler,
  makeSaveHandler,
  readerFeedKey,
  readerSourceState,
  toReaderBusy,
  toReaderItem,
  toReaderSource,
  toReaderStatus,
  useAutoMark,
  useReaderNotices,
  useReaderStores,
} from './article-reader-model';

export type ArticleSelection = {
  kind: 'link' | 'feed';
  key: string;
  title: string;
  url: string;
  read: boolean;
  feedKey?: string | undefined;
};

type ArticleReaderProps = {
  selection?: ArticleSelection | undefined;
  onBack?: (() => void) | undefined;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
};

type ReaderBodyProps = {
  selection: ArticleSelection;
  onBack?: (() => void) | undefined;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
};

const toSelectionFromParams = (
  kindParam: string | undefined,
  keyParam: string | undefined
): ArticleSelection | undefined => {
  if (!keyParam) {
    return undefined;
  }

  return {
    kind: kindParam === 'feed' ? 'feed' : 'link',
    key: keyParam,
    title: '',
    url: '',
    read: false,
  };
};

const useReaderView = (
  selection: ArticleSelection,
  stores: ReturnType<typeof useReaderStores>,
  notices: ReturnType<typeof useReaderNotices>
) => {
  const item = toReaderItem(stores.content);
  const busy = toReaderBusy(stores);
  const status = toReaderStatus(stores, notices.notice);
  const source = toReaderSource(stores.content);
  const canMark = () => !!source();
  const title = () =>
    source()?.title || selection.title || item()?.title || '未命名文章';
  const url = () => source()?.url || selection.url || item()?.url || '';
  const label = () => (item() ? '重新提取' : '提取正文');
  const [sourceMode, setSourceMode] = createSignal<'rss' | 'extracted'>();
  const [webpage, setWebpage] = createSignal(false);
  const sourceState = () =>
    readerSourceState(!!item(), source()?.description, sourceMode());
  const extracted = () => sourceState().extracted;
  const extract = makeExtractHandler(item, notices.setNotice, stores.extract);
  const onExtract = async () => {
    if (await extract()) {
      setSourceMode('extracted');
      setWebpage(false);
    }
  };
  const toggleSource = () => {
    setWebpage(false);
    if (sourceState().canToggle) {
      setSourceMode(extracted() ? 'rss' : 'extracted');
    } else {
      void onExtract();
    }
  };
  const getSelection = () => ({ ...selection, url: url() });

  return {
    item,
    busy,
    status,
    canMark,
    title,
    url,
    label,
    getSelection,
    extracted,
    sourceState,
    webpage,
    toggleWebpage: () => setWebpage((current) => !current),
    onExtract,
    toggleSource,
  };
};

const readerHandlers = (props: {
  view: ReturnType<typeof useReaderView>;
  stores: ReturnType<typeof useReaderStores>;
  notices: ReturnType<typeof useReaderNotices>;
  onBack?: (() => void) | undefined;
}) => ({
  onExtract: props.view.onExtract,
  onMark: makeMarkHandler(
    props.view.getSelection,
    props.stores,
    props.view.busy,
    props.notices.read,
    props.notices.setNotice
  ),
  onDelete: makeDeleteHandler(
    props.view.getSelection().key,
    props.stores,
    props.view.busy,
    props.notices.setNotice,
    props.onBack
  ),
  onSave: makeSaveHandler(
    props.view.getSelection().key,
    props.stores,
    props.view.busy,
    props.notices.setNotice
  ),
});

const ReaderHeader = (props: {
  title: string;
  url: string;
  kind: ArticleSelection['kind'];
  onBack?: (() => void) | undefined;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  view: ReturnType<typeof useReaderView>;
  stores: ReturnType<typeof useReaderStores>;
  notices: ReturnType<typeof useReaderNotices>;
}) => (
  <>
    <ReaderActions
      kind={props.kind}
      url={props.url}
      onBack={props.onBack}
      onPrevious={props.onPrevious}
      onNext={props.onNext}
      canMark={props.view.canMark()}
      busy={props.view.busy()}
      extracting={props.stores.mutation().waiting}
      extractDisabled={
        props.stores.mutation().waiting || props.stores.content().waiting
      }
      actionLabel={props.view.label()}
      canToggleSource={props.view.sourceState().canToggle}
      onToggleSource={props.view.toggleSource}
      webpage={props.view.webpage()}
      onToggleWebpage={props.view.toggleWebpage}
      sourceLabel={
        props.view.sourceState().canToggle
          ? (props.view.extracted() && '显示 RSS 内容') || '显示提取正文'
          : props.view.label()
      }
      read={props.notices.read()}
      {...readerHandlers(props)}
    />
  </>
);

const ReaderBody = (props: ReaderBodyProps) => {
  const stores = useReaderStores(props.selection.kind, props.selection.key);
  const source = toReaderSource(stores.content);
  const notices = useReaderNotices(props.selection, () =>
    readerFeedKey(props.selection, source())
  );
  const view = useReaderView(props.selection, stores, notices);
  const toast = useErrorToast(
    () =>
      stores.mutation().waiting ? undefined : readerError(stores.mutation()),
    () => true
  );
  useAutoMark(props.selection, stores, notices);

  return (
    <section class="m-0 flex h-full min-h-0 w-full flex-col">
      <ReaderHeader
        title={view.title()}
        url={view.url()}
        kind={props.selection.kind}
        onBack={props.onBack}
        onPrevious={props.onPrevious}
        onNext={props.onNext}
        view={view}
        stores={stores}
        notices={notices}
      />
      <Show
        when={view.webpage()}
        fallback={
          <div class="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
            <div class="mx-auto flex max-w-208 flex-col gap-4 px-6 py-8 max-sm:px-4 max-sm:py-6">
              <ReaderTitle title={view.title()} url={view.url()} />
              <ReaderSourceLink url={view.url()} />
              <Show when={view.status()}>
                {(message) => (
                  <p
                    class="text-sm leading-relaxed text-base-content/60"
                    role="status"
                  >
                    {message()}
                  </p>
                )}
              </Show>
              <ReaderContent
                stores={stores}
                item={view.item}
                extracted={view.extracted()}
              />
            </div>
          </div>
        }
      >
        <WebpageFrame url={view.url()} />
      </Show>
      <Show when={toast.message()}>
        {(message) => (
          <ErrorToast message={message()} onDismiss={toast.dismiss} />
        )}
      </Show>
    </section>
  );
};

export const ArticleReader = (props: ArticleReaderProps) => {
  const params = useParams<{ kind?: string; key?: string }>();
  const selection = () =>
    props.selection ?? toSelectionFromParams(params.kind, params.key);
  const selectionKey = () => {
    const current = selection();

    return current ? `${current.kind}:${current.key}` : undefined;
  };

  return (
    <Show
      when={selectionKey()}
      keyed
      fallback={
        <div class="mx-auto w-full max-w-3xl px-4 py-4 sm:px-6 sm:py-6">
          <div class="rounded-box border border-dashed border-base-300 bg-base-200/40 px-6 py-12 text-center">
            <p class="text-sm leading-relaxed text-base-content/70">
              请选择一篇文章开始阅读。
            </p>
          </div>
        </div>
      }
    >
      {(key) => {
        const current = selection();
        if (!current || `${current.kind}:${current.key}` !== key) {
          return null;
        }

        return (
          <ReaderBody
            selection={current}
            onBack={props.onBack}
            onPrevious={props.onPrevious}
            onNext={props.onNext}
          />
        );
      }}
    </Show>
  );
};
