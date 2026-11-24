import { feedsApi } from '../api';
import { errorText } from '../components/errorText';
import { t } from '../i18n';
import { invalidateSidebar } from '../state';
import { showToast } from '../ui';

export interface OpmlImport {
  /** Callback ref for the hidden file input; the visible button opens this picker. */
  inputRef: (element: HTMLInputElement) => void;
  openPicker: () => void;
  onChange: (event: Event) => void;
}

/** `OPML-*`: the sidebar and the settings page share the same import flow and toast copy. */
export const useOpmlImport = (): OpmlImport => {
  let input: HTMLInputElement | undefined;

  const importFile = async (file: File): Promise<void> => {
    try {
      const result = await feedsApi.importOpml(file);
      showToast(
        String(
          t('feeds.opmlImportedToast', {
            imported: result.importedFeeds,
            skipped: result.skippedFeeds,
          })
        ),
        'success'
      );
      await invalidateSidebar();
    } catch (error) {
      showToast(errorText(error), 'error');
    }
  };

  const onChange = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0] ?? null;
    target.value = '';
    if (file !== null) void importFile(file);
  };

  const inputRef = (element: HTMLInputElement): void => {
    input = element;
  };

  return { inputRef, openPicker: () => input?.click(), onChange };
};
