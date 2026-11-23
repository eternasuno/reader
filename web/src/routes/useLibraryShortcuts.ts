import { type Accessor, createSignal, onSettled, type Setter } from 'solid-js';
import { openInNewTab } from '../components/openInNewTab';
import { saveOpenArticle, toggleRead } from '../components/readerActions';
import {
  adjacentArticleIds,
  buildLibraryUrl,
  type LibraryScope,
  openArticle,
  rows,
  toggleExtractedMode,
  toggleSidebarCollapse,
} from '../state';

export interface LibraryShortcutsOptions {
  scope: Accessor<LibraryScope>;
  articleId: Accessor<string | null>;
  unreadOnly: Accessor<boolean>;
  drawerOpen: Accessor<boolean>;
  shortcutsOpen: Accessor<boolean>;
  toggleShortcuts: () => void;
  onNavigate: (url: string) => void;
}

const OVERLAY_SELECTOR =
  'dialog[open], [popover]:popover-open, [role="dialog"]';

const isIgnoredEvent = (event: KeyboardEvent): boolean =>
  event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey;

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

const navigateAdjacent = (
  options: LibraryShortcutsOptions,
  direction: 'prevId' | 'nextId'
): void => {
  const targetId =
    options.articleId() === null
      ? (rows()[0]?.id ?? null)
      : adjacentArticleIds()[direction];
  if (targetId === null) return;

  options.onNavigate(
    buildLibraryUrl(options.scope(), {
      articleId: targetId,
      unreadOnly: options.unreadOnly(),
    })
  );
};

const openCurrentOriginal = (): void => {
  const current = openArticle();
  if (current !== null) openInNewTab(current.url);
};

const createKeyHandlers = (
  options: LibraryShortcutsOptions,
  saving: Accessor<boolean>,
  setSaving: Setter<boolean>
): Record<string, () => void> => ({
  '?': () => options.toggleShortcuts(),
  j: () => navigateAdjacent(options, 'nextId'),
  k: () => navigateAdjacent(options, 'prevId'),
  m: () => {
    const current = openArticle();
    if (current !== null) void toggleRead(current);
  },
  s: () => {
    const current = openArticle();
    if (current?.kind === 'feed') {
      void saveOpenArticle(current, saving, setSaving);
    }
  },
  f: () => {
    if (openArticle()?.kind === 'feed') void toggleExtractedMode();
  },
  v: openCurrentOriginal,
  o: openCurrentOriginal,
  u: () =>
    options.onNavigate(
      buildLibraryUrl(options.scope(), {
        unreadOnly: !options.unreadOnly(),
        articleId: options.articleId(),
      })
    ),
  '[': () => toggleSidebarCollapse(),
});

const handleOverlayKey = (
  event: KeyboardEvent,
  options: LibraryShortcutsOptions
): boolean => {
  if (document.querySelector(OVERLAY_SELECTOR) === null) return false;
  if (event.key === '?' && options.shortcutsOpen()) {
    event.preventDefault();
    options.toggleShortcuts();
  }
  return true;
};

const handleEscapeKey = (
  event: KeyboardEvent,
  options: LibraryShortcutsOptions
): void => {
  if (options.articleId() === null || options.drawerOpen()) return;
  event.preventDefault();
  options.onNavigate(
    buildLibraryUrl(options.scope(), { unreadOnly: options.unreadOnly() })
  );
};

const handleKeyDown = (
  event: KeyboardEvent,
  options: LibraryShortcutsOptions,
  handlers: Record<string, () => void>
): void => {
  if (isIgnoredEvent(event) || isEditableTarget(event.target)) return;
  if (handleOverlayKey(event, options)) return;
  if (event.key === 'Escape') {
    handleEscapeKey(event, options);
    return;
  }

  const handler = Object.hasOwn(handlers, event.key)
    ? handlers[event.key]
    : undefined;
  if (handler === undefined) return;

  event.preventDefault();
  handler();
};

/** Global library & reader keyboard shortcuts (`?`, `j`/`k`, `m`, `s`, `f`, `v`/`o`, `u`, `[`, `Esc`). */
export const useLibraryShortcuts = (options: LibraryShortcutsOptions): void => {
  const [saving, setSaving] = createSignal(false);
  const handlers = createKeyHandlers(options, saving, setSaving);

  onSettled(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      handleKeyDown(event, options, handlers);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
};
