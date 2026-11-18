import { createEffect, Show } from 'solid-js';
import type { Article } from '../library';
import { RemoveSavedPageDialog } from '../saved-page';
import { Icon } from '../ui/icon';
import { followRoute, readerArticle, readerMode } from './article';
import { ReaderContent } from './content';
import { EmbeddedPage } from './embedded';
import { ReaderHeader } from './header';
import { readerMessages as copy } from './messages';
import { startArticle } from './mode';

/** No article open (RD-EMPTY-1). */
const ReaderEmpty = () => (
  <div class="grid h-full place-items-center bg-base-100/30 px-6 text-center">
    <div class="flex flex-col items-center gap-4">
      <Icon name="reading" class="size-10 text-base-content/25" />
      <p class="text-xl font-medium text-base-content/80">{copy.emptyTitle}</p>
      <p class="text-sm leading-relaxed text-base-content/60">
        {copy.emptyHint}
      </p>
    </div>
  </div>
);

const ReaderArticlePane = (props: { readonly article: Article }) => (
  <section class="m-0 flex h-full min-h-0 w-full flex-col">
    <ReaderHeader article={props.article} />
    <Show
      when={readerMode() === 'embedded'}
      fallback={<ReaderContent article={props.article} />}
    >
      <EmbeddedPage url={props.article.item.url} />
    </Show>
  </section>
);

/**
 * The reader pane the library shell shows beside the article list (reader.md): it
 * follows the URL to the article it names (RD-ARTICLE-1, RD-ARTICLE-2), starts it
 * in its feed's reader mode (RD-MODE-4), and shows
 * that article with its header — its content, the embedded page or, with no
 * article open, the empty reader (RD-EMPTY-1). The confirmation before removing a
 * saved page is shown from here, because the reader's menu is where it is asked
 * (RD-DELETE).
 */
export const ReaderPane = () => {
  createEffect(() => followRoute());
  createEffect(() => {
    const article = readerArticle();

    if (article !== undefined) startArticle(article);
  });

  return (
    <>
      <Show when={readerArticle()} fallback={<ReaderEmpty />}>
        {(article) => <ReaderArticlePane article={article()} />}
      </Show>
      <RemoveSavedPageDialog />
    </>
  );
};
