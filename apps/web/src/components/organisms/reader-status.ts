import {
  type Accessor,
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';

export type ReadStatusChange = {
  readonly kind: 'link' | 'feed';
  readonly key: string;
  readonly read: boolean;
};

export type BulkReadScope =
  | { readonly kind: 'links' }
  | { readonly kind: 'allfeeds' }
  | { readonly kind: 'singlefeed'; readonly feedKey: string };

export type BulkReadStatusChange = {
  readonly kind: 'link' | 'feed';
  readonly keys: readonly string[];
  readonly read: boolean;
  readonly scope: BulkReadScope;
};

type ReadableEntry = {
  readonly key: string;
  readonly read: boolean;
};

export type ReadOverrides = ReadonlyMap<string, boolean>;

export const unreadKeys = <T extends ReadableEntry>(
  items: readonly T[] | undefined
): readonly string[] =>
  items?.filter((item) => !item.read).map((item) => item.key) ?? [];

export const hasUnread = <T extends ReadableEntry>(
  items: readonly T[] | undefined
): boolean => items?.some((item) => !item.read) ?? false;

export const READER_DATA_CHANGED = 'reader-data-changed';

export const READER_READ_STATUS_CHANGED = 'reader-read-status-changed';

export const READER_BULK_READ_STATUS_CHANGED =
  'reader-bulk-read-status-changed';

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

export const publishReadStatuses = (
  exit: { readonly _tag: string },
  kind: ReadStatusChange['kind'],
  keys: readonly string[],
  read = true
): boolean => {
  if (exit._tag !== 'Success') return false;

  batch(() => {
    for (const key of keys) {
      window.dispatchEvent(
        new CustomEvent<ReadStatusChange>(READER_READ_STATUS_CHANGED, {
          detail: { kind, key, read },
        })
      );
    }
  });

  return true;
};

const readBulkScope = (value: unknown): BulkReadScope | undefined => {
  if (typeof value !== 'object' || value === null || !('kind' in value))
    return undefined;
  if (value.kind === 'links' || value.kind === 'allfeeds')
    return { kind: value.kind };
  if (
    value.kind === 'singlefeed' &&
    'feedKey' in value &&
    typeof value.feedKey === 'string' &&
    value.feedKey !== ''
  ) {
    return { kind: 'singlefeed', feedKey: value.feedKey };
  }

  return undefined;
};

const scopeKindMatches = (
  scope: BulkReadScope,
  kind: 'link' | 'feed'
): boolean => (scope.kind === 'links' ? kind === 'link' : kind === 'feed');

export const feedBulkScope = (feedKey: string): BulkReadScope =>
  feedKey === '' ? { kind: 'allfeeds' } : { kind: 'singlefeed', feedKey };

export const bulkReadMatches = (
  change: BulkReadStatusChange,
  selection: { readonly kind: 'link' | 'feed'; readonly key: string },
  feedKey: string | undefined
): boolean => {
  if (change.keys.includes(selection.key)) return true;
  if (change.scope.kind === 'links') return selection.kind === 'link';
  if (change.scope.kind === 'allfeeds') return selection.kind === 'feed';

  return (
    selection.kind === 'feed' &&
    feedKey !== undefined &&
    feedKey === change.scope.feedKey
  );
};

const readBulkDetail = (
  detail: unknown
): Pick<BulkReadStatusChange, 'kind' | 'keys' | 'read'> | undefined => {
  if (typeof detail !== 'object' || detail === null) return undefined;
  if (!('kind' in detail) || (detail.kind !== 'link' && detail.kind !== 'feed'))
    return undefined;
  if (
    !('keys' in detail) ||
    !Array.isArray(detail.keys) ||
    !detail.keys.every((key) => typeof key === 'string')
  )
    return undefined;
  if (!('read' in detail) || typeof detail.read !== 'boolean') return undefined;

  return { kind: detail.kind, keys: detail.keys, read: detail.read };
};

export const readBulkStatusFromEvent = (
  event: Event
): BulkReadStatusChange | undefined => {
  const detail = (event as CustomEvent<unknown>).detail;
  const fields = readBulkDetail(detail);
  if (!fields) return undefined;
  const scope =
    typeof detail === 'object' && detail !== null && 'scope' in detail
      ? readBulkScope(detail.scope)
      : undefined;
  if (!scope || !scopeKindMatches(scope, fields.kind)) return undefined;

  return { ...fields, scope };
};

export const publishBulkReadStatus = (
  exit: { readonly _tag: string },
  change: BulkReadStatusChange
): boolean => {
  if (exit._tag !== 'Success') return false;
  window.dispatchEvent(
    new CustomEvent<BulkReadStatusChange>(READER_BULK_READ_STATUS_CHANGED, {
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
  overrides: ReadOverrides,
  previous?: readonly T[] | undefined
): ReadOverrides => {
  if (overrides.size === 0 || !items) return overrides;

  const previousByKey = new Map(
    (previous ?? []).map((item) => [item.key, item] as const)
  );
  const next = new Map<string, boolean>();
  for (const item of items) {
    const read = overrides.get(item.key);
    if (read !== undefined && previousByKey.get(item.key) === item) {
      next.set(item.key, read);
    }
  }

  return next.size === overrides.size ? overrides : next;
};

export const projectReadStatus = <T extends ReadableEntry>(
  items: readonly T[] | undefined,
  overrides: ReadOverrides
): readonly T[] | undefined => {
  if (!items || overrides.size === 0) return items;

  let changed = false;
  const projected = items.map((item) => {
    const read = overrides.get(item.key) ?? item.read;
    if (read === item.read) return item;
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
    const previous = result;
    result = current;
    setOverrides((existing) =>
      reconcileReadOverrides(current, existing, previous)
    );
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

  return createMemo(() => projectReadStatus(items(), overrides()));
};
