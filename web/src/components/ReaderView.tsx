import type { JSX } from '@solidjs/web';
import { createEffect, createSignal, Show } from 'solid-js';
import {
  displayMode,
  type LibraryArticle,
  type ReaderLineWidth,
  readerAppearance,
} from '../state';
import { EmbeddedWebpageFrame } from './EmbeddedWebpageFrame';
import { ReaderArticleHeader, ReaderStoredBody } from './ReaderArticle';
import { ReaderToolbar } from './ReaderToolbar';
import type { ReaderNav } from './readerNav';

export interface ReaderViewProps {
  article: LibraryArticle;
  nav: ReaderNav;
  onSaveToLater: () => void;
  onDelete: () => void;
}

const LINE_WIDTH_CLASSES: Record<ReaderLineWidth, string> = {
  narrow: 'max-w-3xl px-7 sm:px-6',
  medium: 'max-w-5xl px-7 sm:px-6 lg:px-8',
  wide: 'max-w-none px-7 sm:px-6 lg:px-10',
};

/** The open-article column: action bar above the scrollable article body. */
export function ReaderView(props: ReaderViewProps): JSX.Element {
  let scrollRef: HTMLDivElement | undefined;
  const [scrolled, setScrolled] = createSignal(false);

  createEffect(
    () => `${props.article.id}:${displayMode()}`,
    () => {
      if (scrollRef) scrollRef.scrollTop = 0;
      setScrolled(false);
    }
  );

  return (
    <div class="flex h-full min-h-0 w-full flex-col">
      <ReaderToolbar
        article={props.article}
        nav={props.nav}
        scrolled={scrolled()}
        onSaveToLater={props.onSaveToLater}
        onDelete={props.onDelete}
      />
      <Show
        when={displayMode() === 'embedded'}
        fallback={
          <div
            ref={scrollRef}
            class="min-h-0 w-full flex-1 overflow-y-auto overscroll-contain"
            onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 4)}
          >
            <Show when={props.article.id || null} keyed>
              {(articleId) => (
                <article
                  data-article-id={articleId}
                  class={[
                    'mx-auto flex min-h-full w-full flex-col gap-4 py-5 animate-fade-in',
                    LINE_WIDTH_CLASSES[readerAppearance().lineWidth],
                  ]}
                >
                  <ReaderArticleHeader article={props.article} />
                  <ReaderStoredBody article={props.article} />
                </article>
              )}
            </Show>
          </div>
        }
      >
        <EmbeddedWebpageFrame
          url={props.article.url}
          title={props.article.title}
        />
      </Show>
    </div>
  );
}
