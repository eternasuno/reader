import { t } from '../i18n';
import { displayMode, extracting, type LibraryArticle } from '../state';

/**
 * `RD-CONTENT-1` / `RD-EXTRACT-1`: the extracted body wins only when the feed
 * reader mode asks for it and an extraction exists.
 */
export const bodyHtml = (article: LibraryArticle): string => {
  if (
    displayMode() === 'extracted' &&
    article.kind === 'feed' &&
    article.extractedContent
  ) {
    return article.extractedContent;
  }

  return article.content || article.description || '';
};

/** `RD-EXTRACT-1`: the icon turns primary when extracted and pulses while extracting. */
export const extractIconClass = (): string => {
  if (extracting()) {
    return 'animate-pulse text-primary';
  }

  return displayMode() === 'extracted' ? 'text-primary' : '';
};

/** `RD-EXTRACT-1`: the toolbar toggle reads as the action it performs. */
export const extractLabel = (): string =>
  t(
    displayMode() === 'extracted'
      ? 'reader.backToOriginal'
      : 'reader.extractContent'
  );
