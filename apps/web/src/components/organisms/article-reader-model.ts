import {
  useAtomRefresh,
  useAtomSet,
  useAtomValue,
} from '@effect/atom-solid/Hooks';
import { Exit, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import {
  type Accessor,
  createComputed,
  createEffect,
  createSignal,
  onCleanup,
} from 'solid-js';
import { makeFeedAtoms } from '../../lib/feeds';
import { makeReadingAtoms } from '../../lib/links';
import { makeReaderAtoms, readerError } from '../../lib/reader';
import {
  type BulkReadStatusChange,
  bulkReadMatches,
  notifyReaderDataChanged,
  publishReadStatus,
  READER_BULK_READ_STATUS_CHANGED,
  READER_READ_STATUS_CHANGED,
  readBulkStatusFromEvent,
  readStatusFromEvent,
} from './reader-status';

export type ReaderSelection = {
  kind: 'link' | 'feed';
  key: string;
  title: string;
  url: string;
  read: boolean;
  feedKey?: string | undefined;
};

export const useReaderStores = (kind: ReaderSelection['kind'], key: string) => {
  const atoms = makeReaderAtoms(kind, key);
  const content = useAtomValue(() => atoms.content);
  const mutation = useAtomValue(() => atoms.extract);
  const extract = useAtomSet(() => atoms.extract, { mode: 'promiseExit' });
  const refresh = useAtomRefresh(() => atoms.content);
  const readingAtoms = makeReadingAtoms();
  const feedAtoms = makeFeedAtoms();
  const readingMutation = useAtomValue(() => readingAtoms.command);
  const feedMutation = useAtomValue(() => feedAtoms.command);
  const runReading = useAtomSet(() => readingAtoms.command, {
    mode: 'promiseExit',
  });
  const runFeed = useAtomSet(() => feedAtoms.command, { mode: 'promiseExit' });

  return {
    content,
    mutation,
    extract,
    refresh,
    readingMutation,
    feedMutation,
    runReading,
    runFeed,
  };
};

export type ReaderStores = ReturnType<typeof useReaderStores>;

export const readerFeedKey = (
  selection: Pick<ReaderSelection, 'feedKey'>,
  source: { readonly feedKey?: string | undefined } | undefined
): string | undefined => selection.feedKey ?? source?.feedKey;

export const useReaderNotices = (
  selection: ReaderSelection,
  feedKey: Accessor<string | undefined> = () => selection.feedKey
) => {
  const [read, setRead] = createSignal(selection.read);
  const [notice, setNotice] = createSignal('');
  let pending: BulkReadStatusChange[] = [];
  const handleReadStatus = (event: Event) => {
    const change = readStatusFromEvent(event);
    if (change?.kind === selection.kind && change.key === selection.key)
      setRead(change.read);
  };
  const handleBulkReadStatus = (event: Event) => {
    const change = readBulkStatusFromEvent(event);
    if (!change) return;
    const resolved = feedKey();
    if (bulkReadMatches(change, selection, resolved)) {
      setRead(change.read);

      return;
    }

    if (
      selection.kind === 'feed' &&
      change.scope.kind === 'singlefeed' &&
      resolved === undefined
    ) {
      pending.push(change);
    }
  };
  createComputed(() => {
    const resolved = feedKey();
    if (resolved === undefined || pending.length === 0) return;
    const events = pending;
    pending = [];
    for (const change of events) {
      if (bulkReadMatches(change, selection, resolved)) setRead(change.read);
    }
  });
  window.addEventListener(READER_READ_STATUS_CHANGED, handleReadStatus);
  window.addEventListener(
    READER_BULK_READ_STATUS_CHANGED,
    handleBulkReadStatus
  );
  onCleanup(() => {
    window.removeEventListener(READER_READ_STATUS_CHANGED, handleReadStatus);
    window.removeEventListener(
      READER_BULK_READ_STATUS_CHANGED,
      handleBulkReadStatus
    );
  });

  return { read, setRead, notice, setNotice };
};

export type ReaderNotices = ReturnType<typeof useReaderNotices>;

export const toReaderItem = (content: ReaderStores['content']) => () =>
  Option.getOrUndefined(AsyncResult.value(content()))?.item;

export const toReaderSource = (content: ReaderStores['content']) => () =>
  Option.getOrUndefined(AsyncResult.value(content()))?.source;

export const useAutoMark = (
  selection: ReaderSelection,
  stores: ReaderStores,
  notices: ReaderNotices
) => {
  const source = toReaderSource(stores.content);
  let attempted = false;
  const markRead = async () => {
    const exit = await runMark(stores, selection.kind, selection.key, true);
    publishReadStatus(exit, {
      kind: selection.kind,
      key: selection.key,
      read: true,
    });
  };
  createEffect(() => {
    const loaded = source();
    if (!loaded || attempted) return;
    attempted = true;
    notices.setRead(loaded.read);
    if (loaded.read) return;

    void markRead();
  });
};

export type ReaderItem = ReturnType<typeof toReaderItem>;

export const toReaderBusy = (stores: ReaderStores) => () =>
  stores.content().waiting ||
  stores.mutation().waiting ||
  stores.readingMutation().waiting ||
  stores.feedMutation().waiting;

export const toReaderStatus =
  (
    stores: Pick<ReaderStores, 'content' | 'readingMutation' | 'feedMutation'>,
    notice: () => string
  ) =>
  () =>
    readerError(stores.content()) ||
    readerError(stores.readingMutation()) ||
    readerError(stores.feedMutation()) ||
    notice();

export const readerSourceState = (
  hasCache: boolean,
  description: string | undefined,
  mode: 'rss' | 'extracted' | undefined
) => {
  const canToggle = hasCache && !!description?.trim();

  return { canToggle, extracted: hasCache && (!canToggle || mode !== 'rss') };
};

export const makeExtractHandler =
  (
    item: ReaderItem,
    setNotice: (value: string) => void,
    extract: ReaderStores['extract']
  ) =>
  async () => {
    setNotice('');
    const cached = item();
    if (
      cached &&
      !window.confirm('重新提取会再次调用已配置的正文提取服务，继续？')
    ) {
      return false;
    }

    return Exit.isSuccess(await extract(!!cached));
  };

export const runMark = (
  stores: ReaderStores,
  kind: ReaderSelection['kind'],
  key: string,
  read: boolean
) =>
  kind === 'link'
    ? stores.runReading({ _tag: 'Mark', key, read })
    : stores.runFeed({ _tag: 'Mark', key, read });

export const makeMarkHandler =
  (
    getSelection: () => ReaderSelection,
    stores: ReaderStores,
    busy: () => boolean,
    read: () => boolean,
    setNotice: (value: string) => void
  ) =>
  async () => {
    const selection = getSelection();
    if (busy() || selection.url === '') {
      return;
    }

    setNotice('');
    const next = !read();
    const exit = await runMark(stores, selection.kind, selection.key, next);
    publishReadStatus(exit, {
      kind: selection.kind,
      key: selection.key,
      read: next,
    });
  };

export const makeDeleteHandler =
  (
    key: string,
    stores: ReaderStores,
    busy: () => boolean,
    setNotice: (value: string) => void,
    onBack?: (() => void) | undefined
  ) =>
  async () => {
    if (busy()) {
      return;
    }

    if (!window.confirm('确定删除这个链接？此操作无法撤销。')) {
      return;
    }

    setNotice('');
    const exit = await stores.runReading({ _tag: 'Delete', key });
    if (Exit.isSuccess(exit)) {
      notifyReaderDataChanged();
      onBack?.();
    }
  };

export const makeSaveHandler =
  (
    key: string,
    stores: ReaderStores,
    busy: () => boolean,
    setNotice: (value: string) => void
  ) =>
  async () => {
    if (busy()) {
      return;
    }

    setNotice('');
    const exit = await stores.runFeed({ _tag: 'Save', key });
    if (Exit.isSuccess(exit)) {
      setNotice('已保存到稍后读');
      notifyReaderDataChanged();
    }
  };
