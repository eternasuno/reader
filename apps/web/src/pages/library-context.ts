import { type Accessor, createSignal, type Setter } from 'solid-js';
import {
  type Article,
  type LibraryClient,
  libraryErrorMessage,
} from '../lib/library';
import {
  addPending,
  dropPending,
  findArticle,
  initialLibraryState,
  type LibraryState,
  type LibraryToast,
} from './library-state';

export type LibraryFlags = {
  readonly openVersion: () => number;
  readonly setOpenVersion: (value: number) => void;
};

export type LibraryStore = {
  readonly client: LibraryClient;
  readonly state: Accessor<LibraryState>;
  readonly setState: Setter<LibraryState>;
  readonly flags: LibraryFlags;
  readonly lookup: (id: string) => Article | undefined;
  readonly begin: (id: string) => number;
  readonly end: (id: string, token: number) => boolean;
  readonly version: (id: string) => number | undefined;
  readonly writing: (id: string) => boolean;
  readonly notify: (kind: LibraryToast['kind'], message: string) => void;
  readonly notifyCategory: (category: string, error: unknown) => void;
  readonly clearNotified: (category: string) => void;
};

const createNotifier = (setState: Setter<LibraryState>) => {
  const notified = new Set<string>();

  const notify = (kind: LibraryToast['kind'], message: string) => {
    setState((current) => ({ ...current, toast: { kind, message } }));
  };

  const notifyCategory = (category: string, error: unknown) => {
    if (notified.has(category)) {
      return;
    }

    notified.add(category);
    notify('error', libraryErrorMessage(error));
  };

  const clearNotified = (category: string) => {
    notified.delete(category);
  };

  return { notify, notifyCategory, clearNotified };
};

const createReadTracker = (setState: Setter<LibraryState>) => {
  const tokens = new Map<string, number>();
  const versions = new Map<string, number>();
  const inFlight = new Map<string, Set<number>>();
  let sequence = 0;

  const begin = (id: string): number => {
    sequence += 1;
    tokens.set(id, sequence);
    versions.set(id, sequence);
    const outstanding = inFlight.get(id) ?? new Set<number>();
    outstanding.add(sequence);
    inFlight.set(id, outstanding);
    setState((current) => addPending(current, id));

    return sequence;
  };

  const end = (id: string, token: number): boolean => {
    const outstanding = inFlight.get(id);
    outstanding?.delete(token);
    const latest = tokens.get(id) === token;
    if (outstanding === undefined || outstanding.size === 0) {
      inFlight.delete(id);
      tokens.delete(id);
      setState((current) => dropPending(current, id));
    }

    return latest;
  };

  return {
    begin,
    end,
    version: (id: string) => versions.get(id),
    writing: (id: string) => tokens.has(id),
  };
};

export const createLibraryContext = (client: LibraryClient): LibraryStore => {
  const [state, setState] = createSignal<LibraryState>(initialLibraryState());
  const notifier = createNotifier(setState);
  const reads = createReadTracker(setState);
  const runtime = { openVersion: 0 };
  const flags: LibraryFlags = {
    openVersion: () => runtime.openVersion,
    setOpenVersion: (value) => {
      runtime.openVersion = value;
    },
  };

  return {
    client,
    state,
    setState,
    flags,
    lookup: (id) => findArticle(state(), id),
    ...reads,
    ...notifier,
  };
};

export const dismissToast = (store: LibraryStore) => {
  store.setState((current) => ({ ...current, toast: undefined }));
};
