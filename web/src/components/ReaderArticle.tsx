import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import { formatDateTime, locale, t } from '../i18n';
import {
  articleSource,
  displayMode,
  extracting,
  hostnameOf,
  type LibraryArticle,
} from '../state';
import { ArticleFrame } from './ArticleFrame';
import { bodyHtml } from './readerBody';
import { SiteIcon } from './SiteIcon';

/** `RD-CONTENT-1`: source line, title, then hostname link and published date. */
export function ReaderArticleHeader(props: {
  article: LibraryArticle;
}): JSX.Element {
  const article = () => props.article;
  const source = () => articleSource(article());
  const hostname = () => hostnameOf(article().url);

  return (
    <header class="flex flex-col gap-3">
      <p class="flex items-center gap-2 text-sm text-base-content/70">
        <SiteIcon url={source().url} fallback="globe" size={16} />
        <span class="truncate">{source().title}</span>
      </p>
      <h1 class="text-3xl leading-tight font-bold break-words sm:text-4xl">
        <a
          href={article().url}
          target="_blank"
          rel="noopener noreferrer"
          class="transition-colors hover:text-primary"
        >
          {article().title}
        </a>
      </h1>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/60">
        <Show when={hostname() !== source().title}>
          <a
            href={article().url}
            target="_blank"
            rel="noopener noreferrer"
            class="truncate transition-colors hover:text-primary"
          >
            {hostname()}
          </a>
        </Show>
        <Show when={article().publishedAt}>
          {(publishedAt) => (
            <time datetime={publishedAt()}>
              {formatDateTime(publishedAt(), locale())}
            </time>
          )}
        </Show>
      </div>
    </header>
  );
}

/** `RD-EXTRACT-1`: extracting indicator or stored/extracted article body. */
export function ReaderStoredBody(props: {
  article: LibraryArticle;
}): JSX.Element {
  return (
    <Show
      when={displayMode() === 'extracted' && extracting()}
      fallback={<ReaderContent article={props.article} />}
    >
      <p
        role="status"
        class="flex items-center gap-2 text-sm text-base-content/60"
      >
        <span class="loading loading-spinner loading-sm" aria-hidden="true" />
        {String(t('reader.extracting'))}
      </p>
    </Show>
  );
}

function ReaderContent(props: { article: LibraryArticle }): JSX.Element {
  return (
    <Show
      when={bodyHtml(props.article)}
      fallback={
        <p class="text-sm text-base-content/60">
          {String(t('reader.noContent'))}
        </p>
      }
    >
      {(html) => <ArticleFrame html={html()} title={props.article.title} />}
    </Show>
  );
}
