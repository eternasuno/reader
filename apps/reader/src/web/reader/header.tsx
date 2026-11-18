import type { Article } from '../library';
import { closeArticle } from '../library';
import { IconButton } from '../ui/button';
import { Icon } from '../ui/icon';
import { ReaderActions } from './header-actions';
import { readerMessages as copy } from './messages';
import { nextArticle, openNeighbour, previousArticle } from './nav';

/**
 * The one row above the content, labelled `文章操作` (reader.md Interface): `返回
 * 文章列表`, `上一篇` and `下一篇` — disabled at the ends of the loaded list and
 * for an article the list does not hold (RD-NAV-1, RD-NAV-2) — and the actions on
 * the right. It is present in every mode, so the reader can always be left and
 * the mode changed.
 */
export const ReaderHeader = (props: { readonly article: Article }) => (
  <nav
    aria-label={copy.headerLabel}
    class="z-10 flex h-13 shrink-0 items-center gap-1 border-b border-base-300 bg-base-100 px-4 max-sm:px-2"
  >
    <IconButton label={copy.back} onClick={closeArticle}>
      <Icon name="back" />
    </IconButton>
    <IconButton
      label={copy.previous}
      disabled={previousArticle() === undefined}
      onClick={() => openNeighbour(previousArticle())}
    >
      <Icon name="previous" />
    </IconButton>
    <IconButton
      label={copy.next}
      disabled={nextArticle() === undefined}
      onClick={() => openNeighbour(nextArticle())}
    >
      <Icon name="next" />
    </IconButton>
    <ReaderActions article={props.article} />
  </nav>
);
