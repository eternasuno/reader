import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import { browserHref } from '../api/url';
import { formatDateTime, locale, t } from '../i18n';
import { articleSource, hostnameOf, type LibraryArticle } from '../state';
import { ArticleBody } from './ArticleBody';
import { bodyHtml } from './readerBody';
import { SiteIcon } from './SiteIcon';

function OptionalExternalLink(props: {
  href: string | undefined;
  class: string;
  text: string;
}): JSX.Element {
  return (
    <Show
      when={props.href}
      fallback={<span class={props.class}>{props.text}</span>}
    >
      {(href) => (
        <a
          href={href()}
          target="_blank"
          rel="noopener noreferrer"
          class={props.class}
        >
          {props.text}
        </a>
      )}
    </Show>
  );
}

/** `RD-CONTENT-1`: source line, title, then hostname link and published date. */
export function ReaderArticleHeader(props: {
  article: LibraryArticle;
}): JSX.Element {
  const article = () => props.article;
  const source = () => articleSource(article());
  const hostname = () => hostnameOf(article().url);
  const href = () => browserHref(article().url);

  return (
    <header class="flex flex-col gap-3">
      <p class="flex items-center gap-2 text-sm text-base-content/70">
        <SiteIcon srcs={source().iconSrcs} fallback="globe" size={16} />
        <span class="truncate">{source().title}</span>
      </p>
      <h1 class="text-3xl leading-tight font-bold break-words sm:text-4xl">
        <OptionalExternalLink
          href={href()}
          class="transition-colors hover:text-primary"
          text={article().title}
        />
      </h1>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-base-content/60">
        <Show when={hostname() && hostname() !== source().title}>
          <OptionalExternalLink
            href={href()}
            class="truncate transition-colors hover:text-primary"
            text={hostname()}
          />
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

/** `RD-EXTRACT-1`: stored body; the original stays until extraction completes. */
export function ReaderStoredBody(props: {
  article: LibraryArticle;
}): JSX.Element {
  return (
    <Show
      when={bodyHtml(props.article)}
      fallback={
        <p class="text-sm text-base-content/60">{t('reader.noContent')}</p>
      }
    >
      {(html) => <ArticleBody html={html()} />}
    </Show>
  );
}
