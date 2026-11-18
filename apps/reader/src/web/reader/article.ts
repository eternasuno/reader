import { createSignal } from 'solid-js';
import { getFeedItem } from '../api/feed-item';
import { messageOf } from '../api/messages';
import { getSavedPage } from '../api/saved-page';
import {
  type Article,
  currentScope,
  openArticleId,
  replaceRow,
  rowById,
  setArticleRead,
} from '../library';
import { showToast } from '../ui/toast';

/** What the reader shows (RD-CONTENT, RD-EXTRACT, RD-WEBPAGE). */
export type ReaderMode = 'default' | 'extracted' | 'embedded';

const [stored, setStored] = createSignal<Article>();
const [absent, setAbsent] = createSignal(false);
const [mode, setMode] = createSignal<ReaderMode>('default');
const [extracting, setExtractingSignal] = createSignal(false);

/** Raised by every navigation: only the newest one may change the reader (RD-ARTICLE-5). */
let run = 0;

/** The route names a saved page at `/later` and a feed item at the other scopes (RD-ARTICLE-1). */
const routeKey = (): string | undefined => {
  const id = openArticleId();

  return id === undefined
    ? undefined
    : `${currentScope().kind === 'later' ? 'saved-page' : 'feed-item'}:${id}`;
};

/**
 * The article the reader shows (RD-ARTICLE-2): the row the loaded list already
 * holds, which is shown at once while the fetch runs, else what that fetch
 * answered. An id the server answered with no item leaves the reader empty
 * (RD-ARTICLE-3, RD-EMPTY-2).
 */
export const readerArticle = (): Article | undefined => {
  const id = openArticleId();

  if (id === undefined || absent()) return undefined;

  const row = rowById(id);

  if (row !== undefined) return row;

  const fetched = stored();

  return fetched !== undefined && fetched.item.id === id ? fetched : undefined;
};

export const readerMode = (): ReaderMode => mode();

/** The extraction request runs; the header shows its spinner until it settles (RD-EXTRACT-4). */
export const isExtracting = (): boolean => extracting();

/** The navigation the reader is on, so a late answer can tell it is stale. */
export const articleRun = (): number => run;

export const setReaderMode = (next: ReaderMode): void => {
  setMode(next);
};

export const setExtracting = (running: boolean): void => {
  setExtractingSignal(running);
};

/** The read state of one kind of article, with the kind kept (RD-MODE-2). */
const withRead = (article: Article, read: boolean): Article =>
  article.kind === 'saved-page'
    ? { kind: 'saved-page', item: { ...article.item, read } }
    : { kind: 'feed-item', item: { ...article.item, read } };

/** Takes an article the server answered as the one the reader shows (RD-ARTICLE-2, RD-EXTRACT-5). */
export const adoptArticle = (article: Article): void => {
  setStored(article);
  replaceRow(article);
};

/** Changes the reader's copy of an article, as long as that article is the copy (RD-ARTICLE-5). */
const changeStored = (
  id: string,
  change: (article: Article) => Article
): void => {
  setStored((current) =>
    current === undefined || current.item.id !== id ? current : change(current)
  );
};

const setStoredRead = (id: string, read: boolean): void => {
  changeStored(id, (article) => withRead(article, read));
};

/** Puts back the copy a failed mark changed, unless a newer answer already did (RD-READ-3). */
const revertStoredRead = (id: string, optimistic: boolean): void => {
  changeStored(id, (article) =>
    article.item.read === optimistic ? withRead(article, !optimistic) : article
  );
};

/**
 * Takes the outcome of a read write for the open article (RD-READ-3): a loaded
 * row settles the write itself and the copy follows it, while an article the
 * list does not hold has only the reader's own copy, which takes the settled
 * state. Only the article that is still open changes (RD-ARTICLE-5).
 */
const settleArticleRead = (
  article: Article,
  read: boolean,
  written: boolean
): void => {
  const id = article.item.id;

  if (openArticleId() !== id) return;

  const row = rowById(id);

  if (row !== undefined) setStoredRead(id, row.item.read);
  else if (written) setStoredRead(id, read);
  else revertStoredRead(id, read);
};

/**
 * Marks the article at once and settles what came back (RD-READ-1): the mark is
 * optimistic, `library/` writes the row, rolls it back with the error toast when
 * the request fails, moves the counts, and answers whether it was written.
 */
const writeRead = async (article: Article, read: boolean): Promise<void> => {
  setStoredRead(article.item.id, read);

  const written = await setArticleRead(article, read);

  settleArticleRead(article, read, written);
};

/** Marks the open article read or unread from the header control (RD-READ-2). */
export const toggleArticleRead = async (): Promise<void> => {
  const article = readerArticle();

  if (article !== undefined) await writeRead(article, !article.item.read);
};

const accept = async (article: Article): Promise<void> => {
  adoptArticle(article);

  if (!article.item.read) await writeRead(article, true);
};

const loadSavedPage = async (id: string, current: number): Promise<void> => {
  const { item } = await getSavedPage(id);

  if (current !== run) return;
  if (item === null) {
    setAbsent(true);

    return;
  }

  await accept({ kind: 'saved-page', item });
};

const loadFeedItem = async (id: string, current: number): Promise<void> => {
  const { item } = await getFeedItem(id);

  if (current !== run) return;
  if (item === null) {
    setAbsent(true);

    return;
  }

  await accept({ kind: 'feed-item', item });
};

/** Fetches the article the URL names; a failure keeps what is shown (RD-ARTICLE-4). */
const loadArticle = async (key: string, current: number): Promise<void> => {
  const [kind, id = ''] = key.split(':');

  try {
    if (kind === 'saved-page') await loadSavedPage(id, current);
    else await loadFeedItem(id, current);
  } catch (error) {
    if (current === run) showToast(messageOf(error), 'error');
  }
};

let openKey: string | undefined;

/**
 * Follows the URL (RD-ARTICLE-2): a new id fetches its article, starting on the
 * default content until `startArticle` applies its feed's mode, and ending any
 * extraction (RD-MODE-1, RD-MODE-4, RD-EXTRACT-8). The row
 * the list holds shows at once and the fetched article replaces it; only the
 * newest navigation counts (RD-ARTICLE-5).
 */
export const followRoute = (): void => {
  const key = routeKey();

  if (key === openKey) return;

  openKey = key;

  const current = ++run;

  setStored(undefined);
  setAbsent(false);
  setMode('default');
  setExtractingSignal(false);

  if (key !== undefined) void loadArticle(key, current);
};
