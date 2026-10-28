import {
  useAtomRefresh,
  useAtomSet,
  useAtomValue,
} from '@effect/atom-solid/Hooks';
import { Exit, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { makeFeedAtoms } from '../../lib/feeds';
import { makeReadingAtoms } from '../../lib/links';
import { makeReaderAtoms, readerError } from '../../lib/reader';
import {
  notifyReaderDataChanged,
  publishReadStatus,
  READER_READ_STATUS_CHANGED,
  readStatusFromEvent,
} from './reader-status';

export type ReaderSelection = {
  kind: 'link' | 'feed';
  key: string;
  title: string;
  url: string;
  read: boolean;
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

export const useReaderNotices = (selection: ReaderSelection) => {
  const [read, setRead] = createSignal(selection.read);
  const [notice, setNotice] = createSignal('');
  const handleReadStatus = (event: Event) => {
    const change = readStatusFromEvent(event);
    if (change?.kind === selection.kind && change.key === selection.key)
      setRead(change.read);
  };
  window.addEventListener(READER_READ_STATUS_CHANGED, handleReadStatus);
  onCleanup(() => {
    window.removeEventListener(READER_READ_STATUS_CHANGED, handleReadStatus);
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
  createEffect(() => {
    const loaded = source();
    if (!loaded || attempted) return;
    attempted = true;
    notices.setRead(loaded.read);
    if (loaded.read) return;

    void runMark(stores, selection.kind, selection.key, true).then((exit) => {
      publishReadStatus(exit, {
        kind: selection.kind,
        key: selection.key,
        read: true,
      });
    });
  });
};

export type ReaderItem = ReturnType<typeof toReaderItem>;

export const toReaderBusy = (stores: ReaderStores) => () =>
  stores.content().waiting ||
  stores.mutation().waiting ||
  stores.readingMutation().waiting ||
  stores.feedMutation().waiting;

export const toReaderStatus =
  (stores: ReaderStores, notice: () => string) => () =>
    readerError(stores.mutation()) ||
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
    if (cached && !window.confirm('重新提取会再次消耗 Jina 额度，继续？')) {
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
    if (exit._tag === 'Success') {
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
    if (exit._tag === 'Success') {
      setNotice('已保存到稍后读');
      notifyReaderDataChanged();
    }
  };
