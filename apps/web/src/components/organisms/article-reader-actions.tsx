import { onMount, Show } from 'solid-js';
import { focusWhenReady } from '../../pages/reader-lifecycle';
import { Button } from '../atoms/button';
import { IconButton } from '../atoms/icon-button';
import { ReaderIcon, ReadStatusIcon } from '../atoms/reader-icon';
import { MenuCheckbox } from '../molecules/menu-checkbox';
import { PopoverMenu } from '../molecules/popover-menu';
import type { ReaderSelection } from './article-reader-model';

const focusBackButton = (backButton: HTMLButtonElement) => {
  focusWhenReady(() => {
    const list = document.querySelector('.workspace-list');

    return list && list.getClientRects().length === 0 ? backButton : undefined;
  });
};

export const ReaderTitle = (props: { title: string; url: string }) => (
  <h2 class="min-w-0 text-balance break-words text-lg font-semibold leading-snug text-base-content sm:text-xl">
    <Show when={props.url} fallback={props.title}>
      <a href={props.url} target="_blank" rel="noopener noreferrer">
        {props.title}
      </a>
    </Show>
  </h2>
);

const sourceHostname = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

export const ReaderSourceLink = (props: { url: string }) => (
  <Show when={props.url}>
    <p class="truncate text-xs text-base-content/60" title={props.url}>
      <a href={props.url} target="_blank" rel="noopener noreferrer">
        {sourceHostname(props.url)}
      </a>
    </p>
  </Show>
);

type ReaderActionsProps = {
  kind: ReaderSelection['kind'];
  url: string;
  onBack?: (() => void) | undefined;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  onToggleSource: () => void;
  webpage: boolean;
  onToggleWebpage: () => void;
  sourceLabel: string;
  canToggleSource: boolean;
  canMark: boolean;
  busy: boolean;
  extracting: boolean;
  extractDisabled: boolean;
  actionLabel: string;
  read: boolean;
  onExtract: () => void;
  onMark: () => void;
  onDelete: () => void;
  onSave: () => void;
};

const markLabel = (read: boolean) => (read ? '标为未读' : '标为已读');

const ReaderPrimaryActions = (props: ReaderActionsProps) => (
  <>
    <IconButton
      disabled={
        !props.webpage && props.extractDisabled && !props.canToggleSource
      }
      label={
        (props.webpage && '返回文章视图') ||
        (props.extracting && '正在提取…') ||
        props.sourceLabel
      }
      busy={props.extracting}
      onClick={() => {
        if (props.webpage) {
          props.onToggleWebpage();
        } else {
          props.onToggleSource();
        }
      }}
    >
      <Show
        when={!props.extracting}
        fallback={
          <span class="loading loading-spinner loading-xs" aria-hidden="true" />
        }
      >
        <ReaderIcon name="extract" />
      </Show>
    </IconButton>
    <Show when={props.kind === 'feed'}>
      <IconButton
        disabled={props.busy}
        label="保存到稍后读"
        onClick={() => void props.onSave()}
      >
        <ReaderIcon name="bookmark" />
      </IconButton>
    </Show>
    <IconButton
      disabled={props.busy || !props.canMark}
      label={props.read ? '标为未读' : '标为已读'}
      title={
        props.canMark ? markLabel(props.read) : '正在加载文章信息，稍候可标记'
      }
      onClick={() => void props.onMark()}
    >
      <ReadStatusIcon read={props.read} class="size-4.5" />
    </IconButton>
  </>
);

const ReaderOverflow = (
  props: ReaderActionsProps & {
    closePopover: () => void;
  }
) => (
  <>
    <li>
      <Button
        type="button"
        disabled={props.extractDisabled}
        onClick={() => {
          props.closePopover();
          props.onExtract();
        }}
      >
        <ReaderIcon name="extract" />
        {props.extracting ? '正在提取…' : props.actionLabel}
      </Button>
    </li>
    <li>
      <MenuCheckbox
        label="内嵌网页视图"
        checked={props.webpage}
        disabled={!props.url}
        onChange={props.onToggleWebpage}
      />
    </li>
    <Show when={props.url}>
      <li>
        <a
          href={props.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={props.closePopover}
        >
          <ReaderIcon name="external" />
          打开原文
        </a>
      </li>
    </Show>
    <Show when={props.kind === 'link'}>
      <li>
        <Button
          type="button"
          disabled={props.busy}
          onClick={() => {
            props.closePopover();
            void props.onDelete();
          }}
        >
          <ReaderIcon name="delete" />
          删除
        </Button>
      </li>
    </Show>
  </>
);

const ReaderNavigation = (props: ReaderActionsProps) => (
  <>
    <IconButton
      disabled={!props.onPrevious}
      label="上一篇"
      onClick={() => props.onPrevious?.()}
    >
      <ReaderIcon name="previous" />
    </IconButton>
    <IconButton
      disabled={!props.onNext}
      label="下一篇"
      onClick={() => props.onNext?.()}
    >
      <ReaderIcon name="next" />
    </IconButton>
  </>
);

export const ReaderActions = (props: ReaderActionsProps) => {
  let backButton!: HTMLButtonElement;
  onMount(() => {
    if (props.onBack) focusBackButton(backButton);
  });

  return (
    <nav
      aria-label="文章操作"
      class="z-10 flex h-13 shrink-0 items-center gap-1 border-b border-base-300 bg-base-100 px-4 max-sm:gap-0 max-sm:px-2"
    >
      <Show when={props.onBack}>
        {(back) => (
          <IconButton
            ref={(element) => {
              backButton = element;
            }}
            label="返回"
            onClick={() => back()()}
          >
            <ReaderIcon name="back" />
          </IconButton>
        )}
      </Show>
      <ReaderNavigation {...props} />
      <div class="ms-auto flex items-center gap-1 max-sm:gap-0">
        <ReaderPrimaryActions {...props} />
        <div class="ml-1 border-l border-base-300 pl-1">
          <PopoverMenu
            label="更多文章操作"
            trigger={(target) => (
              <IconButton popoverTarget={target} label="更多操作">
                <ReaderIcon name="more" />
              </IconButton>
            )}
          >
            {(closePopover) => (
              <ReaderOverflow {...props} closePopover={closePopover} />
            )}
          </PopoverMenu>
        </div>
      </div>
    </nav>
  );
};
