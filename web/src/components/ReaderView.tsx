import type { JSX } from '@solidjs/web';
import type { LibraryArticle } from '../state';
import { ReaderArticleBody, ReaderArticleHeader } from './ReaderArticle';
import { ReaderToolbar } from './ReaderToolbar';
import type { ReaderNav } from './readerNav';

export interface ReaderViewProps {
  article: LibraryArticle;
  nav: ReaderNav;
  savingToLater: boolean;
  onSaveToLater: () => void;
  onDelete: () => void;
}

/** The open-article column: action bar above the scrollable article body. */
export function ReaderView(props: ReaderViewProps): JSX.Element {
  return (
    <div class="flex h-full min-h-0 flex-col">
      <ReaderToolbar
        article={props.article}
        nav={props.nav}
        onSaveToLater={props.onSaveToLater}
        onDelete={props.onDelete}
      />
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <article class="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5">
          <ReaderArticleHeader article={props.article} />
          <ReaderArticleBody article={props.article} />
        </article>
      </div>
    </div>
  );
}
