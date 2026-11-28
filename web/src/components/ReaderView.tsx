import type { JSX } from '@solidjs/web';
import { createEffect, createSignal, For, Show } from 'solid-js';
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

const SKELETON_PARAGRAPHS = [
  ['w-full', 'w-full', 'w-11/12', 'w-3/5'],
  ['w-full', 'w-11/12', 'w-full', 'w-4/5'],
  ['w-full', 'w-full', 'w-2/3'],
];

/** Loading placeholder shaped like {@link ReaderView}: toolbar strip, header, paragraphs. */
export function ReaderSkeleton(props: { label: string }): JSX.Element {
  return (
    <div
      role="status"
      aria-label={props.label}
      class="flex h-full min-h-0 w-full flex-col overflow-hidden"
    >
      <div
        aria-hidden="true"
        class="flex min-h-13 items-center gap-1 border-b border-base-300 px-2 py-1.5"
      >
        <div class="skeleton size-8 rounded-field" />
        <div class="skeleton size-8 rounded-field" />
        <span class="flex-1" />
        <div class="skeleton size-8 rounded-field" />
        <div class="skeleton size-8 rounded-field" />
        <div class="skeleton size-8 rounded-field" />
      </div>
      <div
        aria-hidden="true"
        class={[
          'mx-auto flex w-full flex-col gap-4 py-5',
          LINE_WIDTH_CLASSES[readerAppearance().lineWidth],
        ]}
      >
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <div class="skeleton size-4 rounded-full" />
            <div class="skeleton h-3.5 w-32" />
          </div>
          <div class="flex flex-col gap-2 py-1">
            <div class="skeleton h-8 w-11/12 sm:h-9" />
            <div class="skeleton h-8 w-1/2 sm:h-9" />
          </div>
          <div class="skeleton h-3 w-40" />
        </div>
        <For each={SKELETON_PARAGRAPHS}>
          {(lines) => (
            <div class="flex flex-col gap-2.5 pt-2">
              <For each={lines}>
                {(width) => <div class={['skeleton h-4', width]} />}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

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
