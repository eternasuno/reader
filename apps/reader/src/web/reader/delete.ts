import { closeArticle, openArticleId, type SavedPage } from '../library';
import { removeSavedPage } from '../saved-page';

/**
 * Removes the open saved page after its confirmation and, once the removal
 * succeeded, returns to the list of the scope (RD-DELETE-2). A failed removal
 * keeps the page open (RD-DELETE-3). The removal names the page it confirmed:
 * if it settles after the user opened another article, that article stays open
 * (RD-ARTICLE-5).
 */
export const removePage = async (page: SavedPage): Promise<void> => {
  const { id } = page;

  if (!(await removeSavedPage(page))) return;
  if (openArticleId() !== id) return;

  closeArticle();
};
