import { A } from '@solidjs/router';
import { AsyncResult } from 'effect/reactivity';
import { createUniqueId, onMount, Show } from 'solid-js';
import { ReaderIcon } from '../atoms/reader-icon';
import { ArticleFrame } from '../molecules/article-frame';

export { ArticleFrame } from '../molecules/article-frame';

import type {
  ReaderItem,
  ReaderSelection,
  ReaderStores,
} from './article-reader-model';
import { toReaderSource } from './article-reader-model';

const focusBackButton = (backButton: HTMLButtonElement) => {
  if (!window.matchMedia('(max-width: 1000px)').matches) return;
  if (document.querySelector('dialog[open]')) return;
  queueMicrotask(() => {
    if (document.querySelector('dialog[open]')) return;
    if (backButton.isConnected) backButton.focus();
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
  onSettings?: (() => void) | undefined;
};

const markLabel = (read: boolean) => (read ? '标为未读' : '标为已读');

const ReaderPrimaryActions = (props: ReaderActionsProps) => (
  <>
    <button
      type="button"
      class="btn btn-ghost btn-square btn-sm rounded-none"
      disabled={props.extractDisabled && !props.canToggleSource}
      aria-label={props.extracting ? '正在提取…' : props.sourceLabel}
      title={props.extracting ? '正在提取…' : props.sourceLabel}
      aria-busy={props.extracting}
      onClick={props.onToggleSource}
    >
      <Show
        when={!props.extracting}
        fallback={
          <span class="loading loading-spinner loading-xs" aria-hidden="true" />
        }
      >
        <ReaderIcon name="extract" />
      </Show>
    </button>
    <Show when={props.kind === 'feed'}>
      <button
        type="button"
        class="btn btn-ghost btn-square btn-sm rounded-none"
        disabled={props.busy}
        aria-label="保存到稍后读"
        title="保存到稍后读"
        onClick={() => void props.onSave()}
      >
        <ReaderIcon name="bookmark" />
      </button>
    </Show>
    <button
      type="button"
      class="btn btn-ghost btn-square btn-sm rounded-none"
      disabled={props.busy || !props.canMark}
      aria-label={props.read ? '标为未读' : '标为已读'}
      title={
        props.canMark ? markLabel(props.read) : '正在加载文章信息，稍候可标记'
      }
      onClick={() => void props.onMark()}
    >
      <ReaderIcon name={props.read ? 'unread' : 'read'} />
    </button>
    <Show when={props.url}>
      <a
        class="btn btn-ghost btn-square btn-sm rounded-none"
        href={props.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="打开原文"
        title="打开原文"
      >
        <ReaderIcon name="external" />
      </a>
    </Show>
  </>
);

const ReaderOverflow = (
  props: ReaderActionsProps & {
    popoverId: string;
    anchor: string;
    setPopover: (element: HTMLUListElement) => void;
    closePopover: () => void;
  }
) => (
  <ul
    ref={props.setPopover}
    id={props.popoverId}
    popover="auto"
    aria-label="更多文章操作"
    class="dropdown dropdown-end menu w-52 max-w-[calc(100vw-2rem)] rounded-box border border-base-200 bg-base-100 p-2 shadow-lg"
    style={`position-anchor:${props.anchor}`}
  >
    <li>
      <button
        type="button"
        disabled={props.extractDisabled}
        onClick={() => {
          props.closePopover();
          props.onExtract();
        }}
      >
        <ReaderIcon name="extract" />
        {props.extracting ? '正在提取…' : props.actionLabel}
      </button>
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
        <button
          type="button"
          disabled={props.busy}
          onClick={() => {
            props.closePopover();
            void props.onDelete();
          }}
        >
          <ReaderIcon name="delete" />
          删除
        </button>
      </li>
    </Show>
    <li>
      <Show
        when={props.onSettings}
        fallback={
          <A href="/settings" onClick={props.closePopover}>
            <ReaderIcon name="settings" />
            设置 Jina Key
          </A>
        }
      >
        {(settings) => (
          <button
            type="button"
            onClick={() => {
              props.closePopover();
              settings()();
            }}
          >
            <ReaderIcon name="settings" />
            设置 Jina Key
          </button>
        )}
      </Show>
    </li>
  </ul>
);

const ReaderNavigation = (props: ReaderActionsProps) => (
  <>
    <button
      type="button"
      class="btn btn-ghost btn-square btn-sm rounded-none"
      disabled={!props.onPrevious}
      aria-label="上一篇"
      title="上一篇"
      onClick={() => props.onPrevious?.()}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        aria-hidden="true"
      >
        <path d="m6 15 6-6 6 6" />
      </svg>
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-square btn-sm rounded-none"
      disabled={!props.onNext}
      aria-label="下一篇"
      title="下一篇"
      onClick={() => props.onNext?.()}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  </>
);

export const ReaderActions = (props: ReaderActionsProps) => {
  const popoverId = createUniqueId();
  const anchor = `--reader-actions-${popoverId}`;
  let backButton!: HTMLButtonElement;
  let popover!: HTMLUListElement;
  const closePopover = () => popover.hidePopover();
  onMount(() => {
    if (props.onBack) focusBackButton(backButton);
  });

  return (
    <nav
      aria-label="文章操作"
      class="article-reader-toolbar flex items-center gap-1 border-b border-base-200"
    >
      <Show when={props.onBack}>
        {(back) => (
          <button
            ref={backButton}
            type="button"
            class="btn btn-ghost btn-square btn-sm rounded-none"
            aria-label="返回"
            title="返回"
            onClick={() => back()()}
          >
            <ReaderIcon name="back" />
          </button>
        )}
      </Show>
      <ReaderNavigation {...props} />
      <div class="ms-auto flex items-center gap-1">
        <ReaderPrimaryActions {...props} />
        <button
          type="button"
          class="btn btn-ghost btn-square btn-sm rounded-none"
          popovertarget={popoverId}
          style={`anchor-name:${anchor}`}
          aria-label="更多操作"
          title="更多操作"
        >
          <ReaderIcon name="more" />
        </button>
        <ReaderOverflow
          {...props}
          popoverId={popoverId}
          anchor={anchor}
          setPopover={(element) => {
            popover = element;
          }}
          closePopover={closePopover}
        />
      </div>
    </nav>
  );
};

export const ReaderEmpty = () => (
  <div class="rounded-box border border-dashed border-base-300 bg-base-200/40 px-6 py-12 text-center">
    <p class="text-sm leading-relaxed text-base-content/70">
      暂无 RSS 内容或正文缓存。点击提取正文会调用 Jina
      并消耗额度，之后优先读取缓存。
    </p>
  </div>
);

export const ReaderFailure = (props: { onRetry: () => void }) => (
  <div
    class="rounded-box border border-base-200 bg-base-200/40 px-6 py-12 text-center"
    role="alert"
  >
    <p class="text-sm leading-relaxed text-base-content/70">
      正文缓存加载失败，请重试。
    </p>
    <button
      type="button"
      class="btn btn-ghost btn-sm mt-4 min-h-9 rounded-none"
      onClick={props.onRetry}
    >
      重试
    </button>
  </div>
);

export const ReaderLoading = () => (
  <div
    class="flex items-center justify-center gap-3 px-6 py-12 text-sm text-base-content/60"
    role="status"
  >
    <span class="loading loading-spinner loading-sm" aria-hidden="true" />
    正在加载正文缓存…
  </div>
);

export const ReaderLoaded = (props: { item: ReaderItem }) => (
  <Show when={props.item()} fallback={<ReaderEmpty />}>
    {(article) => <ArticleFrame html={article().html} />}
  </Show>
);

export const ReaderContent = (props: {
  stores: ReaderStores;
  item: ReaderItem;
  extracted: boolean;
}) => (
  <Show
    when={!AsyncResult.isFailure(props.stores.content())}
    fallback={<ReaderFailure onRetry={props.stores.refresh} />}
  >
    <Show
      when={
        !props.stores.content().waiting &&
        !AsyncResult.isInitial(props.stores.content())
      }
      fallback={<ReaderLoading />}
    >
      <Show
        when={
          props.extracted
            ? props.item()?.html
            : toReaderSource(props.stores.content)()?.description
        }
        fallback={<ReaderEmpty />}
      >
        {(html) => <ArticleFrame html={html()} />}
      </Show>
    </Show>
  </Show>
);
