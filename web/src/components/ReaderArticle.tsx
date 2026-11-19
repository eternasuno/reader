import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import { formatRelativeTime, locale, t } from '../i18n';
import {
  displayMode,
  extracting,
  hostnameOf,
  type LibraryArticle,
} from '../state';
import { Icon } from '../ui';
import { ArticleFrame } from './ArticleFrame';
import { EmbeddedWebpageFrame } from './EmbeddedWebpageFrame';
import { bodyHtml } from './readerBody';

/** `RD-CONTENT-1`: title, source link, and published time. */
export function ReaderArticleHeader(props: {
  article: LibraryArticle;
}): JSX.Element {
  const article = () => props.article;

  return (
    <header class="flex flex-col gap-2">
      <h1 class="text-xl leading-snug font-semibold break-words">
        <a
          href={article().url}
          target="_blank"
          rel="noopener noreferrer"
          class="transition-colors hover:text-primary"
        >
          {article().title}
        </a>
      </h1>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-base-content/60">
        <a
          href={article().url}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 transition-colors hover:text-primary"
        >
          <Icon name="globe" size={13} />
          <span class="truncate">{hostnameOf(article().url)}</span>
        </a>
        <Show when={article().publishedAt}>
          {(publishedAt) => (
            <>
              <span aria-hidden="true">·</span>
              <time datetime={publishedAt()}>
                {formatRelativeTime(publishedAt(), locale())}
              </time>
            </>
          )}
        </Show>
      </div>
    </header>
  );
}

/** `RD-WEBPAGE-1`: embedded, extracting, extracted, or plain stored body. */
export function ReaderArticleBody(props: {
  article: LibraryArticle;
}): JSX.Element {
  return (
    <Show
      when={displayMode() === 'embedded'}
      fallback={<ReaderStoredBody article={props.article} />}
    >
      <EmbeddedWebpageFrame
        url={props.article.url}
        title={props.article.title}
      />
    </Show>
  );
}

function ReaderStoredBody(props: { article: LibraryArticle }): JSX.Element {
  return (
    <Show
      when={extracting()}
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
