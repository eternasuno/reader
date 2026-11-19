/** URL builders the reader needs; all derived from the active route scope. */
export interface ReaderNav {
  listUrl: () => string;
  laterUrl: () => string;
  articleUrl: (articleId: string) => string;
  onNavigate: (url: string) => void;
}
