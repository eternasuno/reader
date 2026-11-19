import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import { t } from '../i18n';
import {
  adjacentArticleIds,
  type LibraryArticle,
  toggleExtractedMode,
} from '../state';
import { Button, Icon } from '../ui';
import { ReaderMoreMenu } from './ReaderMoreMenu';
import { toggleRead } from './readerActions';
import { extractLabel } from './readerBody';
import type { ReaderNav } from './readerNav';

export interface ReaderToolbarProps {
  article: LibraryArticle;
  nav: ReaderNav;
  onSaveToLater: () => void;
  onDelete: () => void;
}

const readLabel = (article: LibraryArticle): string =>
  String(t(article.read ? 'reader.markUnread' : 'reader.markRead'));

/** `RD-READ-1`, `RD-EXTRACT-1`, `RD-NAV-1`: the article action bar. */
export function ReaderToolbar(props: ReaderToolbarProps): JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label={String(t('reader.articleActions'))}
      class="flex flex-wrap items-center gap-1 border-b border-base-300 px-2 py-2"
    >
      <ReaderNavButtons nav={props.nav} />
      <span class="flex-1" />
      <ReaderActionButtons
        article={props.article}
        onSave={props.onSaveToLater}
      />
      <ReaderMoreMenu
        article={props.article}
        nav={props.nav}
        onDelete={props.onDelete}
      />
    </div>
  );
}

const goAdjacent = (nav: ReaderNav, direction: 'prevId' | 'nextId'): void => {
  const target = adjacentArticleIds()[direction];
  if (target !== null) nav.onNavigate(nav.articleUrl(target));
};

function ReaderNavButtons(props: { nav: ReaderNav }): JSX.Element {
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={String(t('reader.backToList'))}
        title={String(t('reader.backToList'))}
        onClick={() => props.nav.onNavigate(props.nav.listUrl())}
      >
        <Icon name="arrow-left" size={16} />
        <span class="hidden sm:inline">{String(t('reader.backToList'))}</span>
      </Button>
      <Button
        variant="icon"
        size="sm"
        aria-label={String(t('reader.prevArticle'))}
        title={String(t('reader.prevArticle'))}
        disabled={adjacentArticleIds().prevId === null}
        onClick={() => goAdjacent(props.nav, 'prevId')}
      >
        <Icon name="chevron-left" size={18} />
      </Button>
      <Button
        variant="icon"
        size="sm"
        aria-label={String(t('reader.nextArticle'))}
        title={String(t('reader.nextArticle'))}
        disabled={adjacentArticleIds().nextId === null}
        onClick={() => goAdjacent(props.nav, 'nextId')}
      >
        <Icon name="chevron-right" size={18} />
      </Button>
    </>
  );
}

function ReaderActionButtons(props: {
  article: LibraryArticle;
  onSave: () => void;
}): JSX.Element {
  return (
    <>
      <Show when={props.article.kind === 'feed'}>
        <Button
          variant="ghost"
          size="sm"
          aria-label={String(t('reader.saveToLater'))}
          title={String(t('reader.saveToLater'))}
          onClick={props.onSave}
        >
          <Icon name="bookmark" size={16} />
          <span class="hidden sm:inline">
            {String(t('reader.saveToLater'))}
          </span>
        </Button>
      </Show>
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={props.article.read ? 'true' : 'false'}
        aria-label={readLabel(props.article)}
        onClick={() => void toggleRead(props.article)}
      >
        {readLabel(props.article)}
      </Button>
      <Show when={props.article.kind === 'feed'}>
        <Button
          variant="icon"
          size="sm"
          aria-label={extractLabel()}
          title={extractLabel()}
          onClick={() => void toggleExtractedMode()}
        >
          <Icon name="extract" size={18} />
        </Button>
      </Show>
    </>
  );
}
