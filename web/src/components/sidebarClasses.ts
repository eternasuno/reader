/** Shared row chrome for sidebar scopes, feeds, and folders. */
export const ROW_CLASSES =
  'group flex items-center gap-1 rounded-field pr-1 transition-colors';
export const ROW_BUTTON_CLASSES =
  'flex min-w-0 flex-1 items-center gap-2.5 rounded-field px-2 py-2 text-left text-sm focus-visible:outline-none';
/** Plain muted number, inheriting the row color so it stays legible on the selected fill. */
export const COUNT_CLASSES = 'px-1.5 text-xs tabular-nums opacity-60';

export const rowClasses = (active: boolean): string =>
  active
    ? 'bg-neutral text-neutral-content'
    : 'text-base-content/85 hover:bg-base-200 focus-within:bg-base-200';

export const rowTextClasses = (active: boolean): string =>
  active ? 'font-semibold' : 'font-medium';
