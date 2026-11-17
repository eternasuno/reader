/**
 * The reader pane (reader.md): which article the URL names, its default, extracted
 * and embedded views, the header actions, moving between the articles of the
 * loaded list, the read toggle, and the empty reader. The article list and the
 * scope it belongs to are `library/`'s; saving and deleting go through
 * `saved-page/`.
 */
export {
  followRoute,
  isExtracting,
  type ReaderMode,
  readerArticle,
  readerMode,
  toggleArticleRead,
} from './article';
export { defaultHtml, extractedHtml } from './content';
export { setEmbeddedView, toggleExtraction } from './mode';
export { nextArticle, openNeighbour, previousArticle } from './nav';
export { ReaderPane } from './reader-pane';
export { embeddableUrl } from './webpage';
