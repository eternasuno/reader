/** Keys handled by `useLibraryShortcuts` and forwarded from `ArticleFrame`. */
export const LIBRARY_SHORTCUT_KEYS = [
  'j',
  'k',
  'm',
  's',
  'f',
  'v',
  'o',
  'u',
  '[',
  '?',
] as const;

export type LibraryShortcutKey = (typeof LIBRARY_SHORTCUT_KEYS)[number];

export const BRIDGED_FRAME_KEYS: ReadonlyArray<string> = [
  ...LIBRARY_SHORTCUT_KEYS,
  'Escape',
];
