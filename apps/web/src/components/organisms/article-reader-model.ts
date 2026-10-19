import {
  useAtomRefresh,
  useAtomSet,
  useAtomValue,
} from '@effect/atom-solid/Hooks';
import { Exit, Option } from 'effect';
import { AsyncResult } from 'effect/reactivity';
import { createEffect, createSignal } from 'solid-js';
import { makeFeedAtoms } from '../../lib/feeds';
import { makeReadingAtoms } from '../../lib/links';
import { makeReaderAtoms, readerError } from '../../lib/reader';

export type ReaderSelection = {
  kind: 'link' | 'feed';
  key: string;
  title: string;
  url: string;
  read: boolean;
};

export const READER_DATA_CHANGED = 'reader-data-changed';

export const notifyReaderDataChanged = () => {
  window.dispatchEvent(new CustomEvent(READER_DATA_CHANGED));
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

export const useReaderNotices = (initialRead: boolean) => {
  const [read, setRead] = createSignal(initialRead);
  const [notice, setNotice] = createSignal('');
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
      if (exit._tag === 'Success') notices.setRead(true);
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
    setRead: (value: boolean) => void,
    setNotice: (value: string) => void
  ) =>
  async () => {
    const selection = getSelection();
    if (busy() || selection.url === '') {
      return;
    }
    setNotice('');
    const exit = await runMark(stores, selection.kind, selection.key, !read());
    if (exit._tag === 'Success') {
      setRead(!read());
      notifyReaderDataChanged();
    }
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
