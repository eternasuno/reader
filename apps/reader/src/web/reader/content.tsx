import { Show } from 'solid-js';
import type { Article } from '../library';
import { ArticleFrame } from '../ui/article-frame';
import { readerMode } from './article';
import { readerMessages as copy } from './messages';

/**
 * The default content of an article (RD-CONTENT-1): the stored content, else its
 * description, else nothing — the saved HTML of the article is shown untouched
 * (RD-CONTENT-2), always inside the article frame (RD-FRAME).
 */
export const defaultHtml = (article: Article): string | undefined =>
  article.kind === 'saved-page'
    ? article.item.content
    : (article.item.content ?? article.item.description);

/** The extracted content of an article (RD-EXTRACT), the article's own text for a saved page. */
export const extractedHtml = (article: Article): string | undefined =>
  article.kind === 'saved-page'
    ? article.item.content
    : article.item.extractedContent;

/** The HTML of the mode the reader is in. */
const shownHtml = (article: Article): string | undefined =>
  readerMode() === 'extracted' ? extractedHtml(article) : defaultHtml(article);

const ReaderText = (props: { readonly article: Article }) => (
  <Show
    when={shownHtml(props.article)}
    fallback={
      <p class="rounded-box border border-dashed border-base-300 bg-base-200/40 px-6 py-12 text-center text-sm leading-relaxed text-base-content/70">
        {copy.noContent}
      </p>
    }
  >
    {(html) => <ArticleFrame html={html()} />}
  </Show>
);

/**
 * The centered reading column of the reader (reader.md Content): the title linked
 * to the article's URL in a new tab, the source hostname below it linking to the
 * same address with the full URL as its tooltip (RD-CONTENT-3), then the article
 * HTML in the isolated frame.
 */
export const ReaderContent = (props: { readonly article: Article }) => (
  <div class="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
    <div class="mx-auto flex max-w-208 flex-col gap-4 px-6 py-8 max-sm:px-4 max-sm:py-6">
      <h2 class="min-w-0 text-balance break-words text-lg font-semibold leading-snug text-base-content sm:text-xl">
        <a
          href={props.article.item.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {props.article.item.title}
        </a>
      </h2>
      <p
        class="truncate text-xs text-base-content/60"
        title={props.article.item.url}
      >
        <a
          href={props.article.item.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {new URL(props.article.item.url).hostname}
        </a>
      </p>
      <ReaderText article={props.article} />
    </div>
  </div>
);
