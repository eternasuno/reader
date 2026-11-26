import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import type { Feed } from '../api';
import { t } from '../i18n';
import {
  adjacentArticleIds,
  type LibraryArticle,
  toggleExtractedMode,
} from '../state';
import { Button, Icon } from '../ui';
import { ReaderMoreMenu } from './ReaderMoreMenu';
import { toggleRead } from './readerActions';
import { extractIconClass, extractLabel } from './readerBody';
import type { ReaderNav } from './readerNav';

export interface ReaderToolbarProps {
  article: LibraryArticle;
  nav: ReaderNav;
  scrolled?: boolean;
  onSaveToLater: () => void;
  onDelete: () => void;
  onRequestFeedOptions: (feed: Feed) => void;
}

const readLabel = (article: LibraryArticle): string =>
  t(article.read ? 'reader.markUnread' : 'reader.markRead');

/** `RD-READ-1`, `RD-EXTRACT-1`, `RD-NAV-1`: the icon-only article action bar. */
export function ReaderToolbar(props: ReaderToolbarProps): JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label={t('reader.articleActions')}
      class={[
        'flex min-h-13 flex-wrap items-center gap-1 border-b border-base-300 px-2 py-1.5 transition-shadow',
        props.scrolled ? 'shadow-md' : '',
      ]}
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
        onRequestFeedOptions={props.onRequestFeedOptions}
      />
    </div>
  );
}

const goAdjacent = (nav: ReaderNav, direction: 'prevId' | 'nextId'): void => {
  const target = adjacentArticleIds()[direction];
  if (target !== null) nav.onNavigate(nav.articleUrl(target));
};

function ToolbarButton(props: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Button
      variant="icon"
      size="sm"
      class="max-md:size-10"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

/** The list stays visible beside the reader on wide screens, so "back" reads as close there. */
function ReaderNavButtons(props: { nav: ReaderNav }): JSX.Element {
  return (
    <>
      <ToolbarButton
        label={t('reader.backToList')}
        onClick={() => props.nav.onNavigate(props.nav.listUrl())}
      >
        <span class="inline-flex lg:hidden">
          <Icon name="arrow-left" size={18} />
        </span>
        <span class="hidden lg:inline-flex">
          <Icon name="close" size={18} />
        </span>
      </ToolbarButton>
      <ToolbarButton
        label={t('reader.prevArticle')}
        disabled={adjacentArticleIds().prevId === null}
        onClick={() => goAdjacent(props.nav, 'prevId')}
      >
        <Icon name="chevron-up" size={18} />
      </ToolbarButton>
      <ToolbarButton
        label={t('reader.nextArticle')}
        disabled={adjacentArticleIds().nextId === null}
        onClick={() => goAdjacent(props.nav, 'nextId')}
      >
        <Icon name="chevron-down" size={18} />
      </ToolbarButton>
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
        <ToolbarButton
          label={extractLabel()}
          onClick={() => void toggleExtractedMode()}
        >
          <Icon name="extract" size={18} class={extractIconClass()} />
        </ToolbarButton>
        <ToolbarButton label={t('reader.saveToLater')} onClick={props.onSave}>
          <Icon name="bookmark" size={18} />
        </ToolbarButton>
      </Show>
      <ToolbarButton
        label={readLabel(props.article)}
        onClick={() => void toggleRead(props.article)}
      >
        <Icon
          name={props.article.read ? 'circle' : 'circle-filled'}
          size={18}
          class={props.article.read ? '' : 'text-primary'}
        />
      </ToolbarButton>
    </>
  );
}
