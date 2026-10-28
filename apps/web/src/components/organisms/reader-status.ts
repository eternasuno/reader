import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

export type ReadStatusChange = {
  readonly kind: 'link' | 'feed';
  readonly key: string;
  readonly read: boolean;
};

type ReadableEntry = {
  readonly key: string;
  readonly read: boolean;
};

export type ReadOverrides = ReadonlyMap<string, boolean>;

export const READER_DATA_CHANGED = 'reader-data-changed';

export const READER_READ_STATUS_CHANGED = 'reader-read-status-changed';

export const notifyReaderDataChanged = () => {
  window.dispatchEvent(new CustomEvent(READER_DATA_CHANGED));
};

export const readStatusFromEvent = (
  event: Event
): ReadStatusChange | undefined => {
  const detail = (event as CustomEvent<unknown>).detail;
  if (typeof detail !== 'object' || detail === null) return undefined;
  if (!('kind' in detail) || (detail.kind !== 'link' && detail.kind !== 'feed'))
    return undefined;
  if (!('key' in detail) || typeof detail.key !== 'string') return undefined;
  if (!('read' in detail) || typeof detail.read !== 'boolean') return undefined;

  return { kind: detail.kind, key: detail.key, read: detail.read };
};

export const publishReadStatus = (
  exit: { readonly _tag: string },
  change: ReadStatusChange
): boolean => {
  if (exit._tag !== 'Success') return false;
  window.dispatchEvent(
    new CustomEvent<ReadStatusChange>(READER_READ_STATUS_CHANGED, {
      detail: change,
    })
  );

  return true;
};

export const recordReadOverride = <T extends ReadableEntry>(
  items: readonly T[] | undefined,
  overrides: ReadOverrides,
  change: ReadStatusChange
): ReadOverrides => {
  if (items && !items.some((candidate) => candidate.key === change.key))
    return overrides;
  if (overrides.get(change.key) === change.read) return overrides;

  const next = new Map(overrides);
  next.set(change.key, change.read);

  return next;
};

export const reconcileReadOverrides = <T extends ReadableEntry>(
  items: readonly T[] | undefined,
  overrides: ReadOverrides
): ReadOverrides => {
  if (overrides.size === 0 || !items) return overrides;

  return new Map();
};

export const projectReadStatus = <T extends ReadableEntry>(
  items: readonly T[] | undefined,
  overrides: ReadOverrides
): readonly T[] | undefined => {
  if (!items || overrides.size === 0) return items;

  let changed = false;
  const projected = items.map((item) => {
    const read = overrides.get(item.key);
    if (read === undefined || read === item.read) return item;
    changed = true;

    return { ...item, read };
  });

  return changed ? projected : items;
};

export const useReaderDataRefresh = (...refreshes: (() => void)[]) => {
  const handle = () => {
    for (const refresh of refreshes) refresh();
  };
  window.addEventListener(READER_DATA_CHANGED, handle);
  onCleanup(() => {
    window.removeEventListener(READER_DATA_CHANGED, handle);
  });
};

export const createReadStatusProjection = <T extends ReadableEntry>(
  kind: ReadStatusChange['kind'],
  items: Accessor<readonly T[] | undefined>
): Accessor<readonly T[] | undefined> => {
  const [overrides, setOverrides] = createSignal<ReadOverrides>(new Map());
  let result: readonly T[] | undefined;
  createEffect(() => {
    const current = items();
    if (current === result) return;
    result = current;
    setOverrides((existing) => reconcileReadOverrides(current, existing));
  });
  const handleReadStatus = (event: Event) => {
    const change = readStatusFromEvent(event);
    if (!change || change.kind !== kind) return;
    setOverrides((existing) => recordReadOverride(items(), existing, change));
  };
  window.addEventListener(READER_READ_STATUS_CHANGED, handleReadStatus);
  onCleanup(() => {
    window.removeEventListener(READER_READ_STATUS_CHANGED, handleReadStatus);
  });

  return () => projectReadStatus(items(), overrides());
};
