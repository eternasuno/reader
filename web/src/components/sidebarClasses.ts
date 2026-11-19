/** Shared row chrome for sidebar scopes, feeds, and folders. */
export const ROW_CLASSES =
  'flex items-center gap-1 rounded-field pr-1 transition-colors focus-within:bg-base-200';
export const ROW_BUTTON_CLASSES =
  'flex min-w-0 flex-1 items-center gap-2 rounded-field px-2 py-2 text-left text-sm focus-visible:outline-none';
export const COUNT_CLASSES =
  'badge badge-sm border-0 bg-base-300 font-normal text-base-content/70 tabular-nums';

export const rowClasses = (active: boolean): string =>
  active ? 'bg-base-200' : 'hover:bg-base-200/60';

export const rowTextClasses = (active: boolean): string =>
  active ? 'font-medium text-base-content' : 'text-base-content/80';
