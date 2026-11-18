import { extractFeedItem } from '../api/feed-item';
import { messageOf } from '../api/messages';
import type { Article } from '../library';
import { showToast } from '../ui/toast';
import {
  adoptArticle,
  articleRun,
  isExtracting,
  readerArticle,
  readerMode,
  setExtracting,
  setReaderMode,
} from './article';
import { extractedHtml } from './content';

/** Requests the extraction of the open feed item and shows it when it answers (FD-EXTRACT). */
const extract = async (article: Article): Promise<void> => {
  if (article.kind !== 'feed-item') return;

  const current = articleRun();

  setExtracting(true);

  try {
    const { item } = await extractFeedItem(article.item.id);

    if (current !== articleRun()) return;

    adoptArticle({ kind: 'feed-item', item });
    setReaderMode('extracted');
  } catch (error) {
    if (current === articleRun()) showToast(messageOf(error), 'error');
  } finally {
    if (current === articleRun()) setExtracting(false);
  }
};

/**
 * Switches between the default and the extracted content (RD-EXTRACT): back to
 * the default content changes nothing on the server (RD-EXTRACT-6), cached
 * extraction is shown at once and sends nothing (RD-EXTRACT-3), and only a first
 * extraction waits for its answer before switching (RD-EXTRACT-5) — a failed one
 * leaves the view as it was (RD-EXTRACT-7) and a late one for another article is
 * dropped (RD-EXTRACT-8).
 */
export const toggleExtraction = async (): Promise<void> => {
  const article = readerArticle();

  if (article === undefined || isExtracting()) return;

  if (readerMode() === 'extracted') {
    setReaderMode('default');

    return;
  }

  if (extractedHtml(article) !== undefined) {
    setReaderMode('extracted');

    return;
  }

  await extract(article);
};

/** Checks or unchecks the embedded page; unchecking returns to the content (RD-WEBPAGE-1). */
export const setEmbeddedView = (on: boolean): void => {
  setReaderMode(on ? 'embedded' : 'default');
};
