import type { JSX } from '@solidjs/web';
import { For } from 'solid-js';
import { t } from '../i18n';
import { Dialog } from '../ui';

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: 'j', label: 'library.shortcutNext' },
  { key: 'k', label: 'library.shortcutPrev' },
  { key: 'm', label: 'library.shortcutToggleRead' },
  { key: 's', label: 'library.shortcutSaveToLater' },
  { key: 'f', label: 'library.shortcutExtract' },
  { key: 'v / o', label: 'library.shortcutOpenOriginal' },
  { key: 'u', label: 'library.shortcutUnreadOnly' },
  { key: '[', label: 'library.shortcutToggleSidebar' },
  { key: 'Esc', label: 'library.shortcutCloseArticle' },
  { key: '?', label: 'library.shortcutHelp' },
] as const;

/** `LIB-KEY-1`: keyboard shortcuts reference dialog opened with `?`. */
export function KeyboardShortcutsDialog(
  props: KeyboardShortcutsDialogProps
): JSX.Element {
  return (
    <Dialog
      open={props.open}
      title={String(t('library.shortcuts'))}
      closeLabel={String(t('common.close'))}
      class="max-w-lg"
      onClose={props.onClose}
    >
      <p class="mb-3 text-xs text-base-content/60">
        {String(t('library.shortcutsHint'))}
      </p>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <For each={SHORTCUTS}>
          {(item) => (
            <div class="flex items-center justify-between gap-2 rounded-field bg-base-200/60 px-3 py-2 text-sm">
              <span class="text-base-content/80">{String(t(item.label))}</span>
              <kbd class="kbd kbd-sm font-mono">{item.key}</kbd>
            </div>
          )}
        </For>
      </div>
    </Dialog>
  );
}
