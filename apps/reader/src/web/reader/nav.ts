import { type Article, openArticle, openArticleId, rows } from '../library';

/** Where the open article sits in the loaded list; -1 when the list does not hold it. */
const openIndex = (): number => {
  const id = openArticleId();
  const list = rows();

  return id === undefined ? -1 : list.findIndex((row) => row.item.id === id);
};

/** The row above the open article; none at the first row or when it is not loaded (RD-NAV-1, RD-NAV-2). */
export const previousArticle = (): Article | undefined => {
  const index = openIndex();

  return index > 0 ? rows()[index - 1] : undefined;
};

/** The row below the open article; none at the last row or when it is not loaded (RD-NAV-1, RD-NAV-2). */
export const nextArticle = (): Article | undefined => {
  const index = openIndex();
  const list = rows();

  return index >= 0 ? list[index + 1] : undefined;
};

/** Opens a neighbour exactly as the list does (RD-NAV-3). */
export const openNeighbour = (article: Article | undefined): void => {
  if (article !== undefined) openArticle(article.item.id);
};
