import { createSignal, Show } from 'solid-js';
import type { Article, FeedItem } from '../library';
import { saveToLater } from '../saved-page';
import { Button, IconButton } from '../ui/button';
import { Icon, ReadStatusIcon } from '../ui/icon';
import { Menu } from '../ui/menu';
import { MenuCheckbox } from '../ui/menu-checkbox';
import { isExtracting, readerMode, toggleArticleRead } from './article';
import { removePage } from './delete';
import { readerMessages as copy } from './messages';
import { setEmbeddedView, toggleExtraction } from './mode';

/**
 * `保存到稍后阅读`, offered on a feed item only (RD-SAVE-1): it waits on a remote
 * fetch, so the control shows a spinner and is disabled while the request runs
 * (`reader-spec` Client conventions). The reader stays on the item afterwards
 * (RD-SAVE-2).
 */
const SaveAction = (props: { readonly item: FeedItem }) => {
  const [saving, setSaving] = createSignal(false);

  const save = async () => {
    setSaving(true);

    try {
      await saveToLater(props.item);
    } finally {
      setSaving(false);
    }
  };

  return (
    <IconButton label={copy.save} busy={saving()} onClick={() => void save()}>
      <Show when={!saving()}>
        <Icon name="bookmark" />
      </Show>
    </IconButton>
  );
};

/** The read control: the article's state, offering the opposite (RD-READ-2). */
const ReadAction = (props: { readonly article: Article }) => (
  <IconButton
    label={props.article.item.read ? copy.markUnread : copy.markRead}
    onClick={() => void toggleArticleRead()}
  >
    <ReadStatusIcon read={props.article.item.read} class="size-4.5" />
  </IconButton>
);

/**
 * The extraction control (RD-EXTRACT-1): an outline icon while the default
 * content shows, a solid one in the accent and pressed while the extracted
 * content shows, and a spinner with an announced status line while the request
 * runs, which also disables the control (RD-EXTRACT-2, RD-EXTRACT-4).
 */
const ExtractAction = () => {
  const extracted = () => readerMode() === 'extracted';

  return (
    <div class="flex shrink-0 items-center">
      <IconButton
        label={extracted() ? copy.extractOff : copy.extract}
        pressed={extracted()}
        busy={isExtracting()}
        disabled={isExtracting()}
        onClick={() => void toggleExtraction()}
      >
        <Show when={!isExtracting()}>
          <Icon
            name={extracted() ? 'extractFilled' : 'extract'}
            class={`size-5 ${extracted() ? 'text-primary' : ''}`}
          />
        </Show>
      </IconButton>
      <Show when={isExtracting()}>
        <span role="status" class="sr-only">
          {copy.extracting}
        </span>
      </Show>
    </div>
  );
};

/**
 * The overflow menu (reader.md Interface): the embedded-page checkbox, `打开原文`
 * and, for a saved page only, the destructive `删除` separated from the others
 * (RD-DELETE-1). There is no `原文` entry (RD-CONTENT-4).
 */
const ReaderMenu = (props: { readonly article: Article }) => {
  const page = () =>
    props.article.kind === 'saved-page' ? props.article.item : undefined;

  return (
    <Menu
      label={copy.menuLabel}
      trigger={(target) => (
        <IconButton popoverTarget={target} label={copy.more}>
          <Icon name="more" />
        </IconButton>
      )}
    >
      {(close) => (
        <>
          <li>
            <MenuCheckbox
              label={copy.embedded}
              checked={readerMode() === 'embedded'}
              onChange={(on) => {
                close();
                setEmbeddedView(on);
              }}
            />
          </li>
          <li>
            <a
              href={props.article.item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={close}
            >
              <Icon name="external" />
              {copy.openOriginal}
            </a>
          </li>
          <Show when={page()}>
            {(saved) => (
              <li class="mt-2 border-t border-base-300 pt-2">
                <Button
                  type="button"
                  class="text-error"
                  onClick={() => {
                    close();
                    void removePage(saved());
                  }}
                >
                  <Icon name="delete" />
                  {copy.remove}
                </Button>
              </li>
            )}
          </Show>
        </>
      )}
    </Menu>
  );
};

/** The right-hand actions of the header (reader.md Interface). */
export const ReaderActions = (props: { readonly article: Article }) => {
  const item = () =>
    props.article.kind === 'feed-item' ? props.article.item : undefined;

  return (
    <div class="ms-auto flex items-center gap-1">
      <Show when={item()}>
        {(feedItem) => <SaveAction item={feedItem()} />}
      </Show>
      <ReadAction article={props.article} />
      <ExtractAction />
      <ReaderMenu article={props.article} />
    </div>
  );
};
