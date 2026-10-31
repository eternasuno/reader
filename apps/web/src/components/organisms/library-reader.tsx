import { createEffect, createSignal, For, on, Show } from 'solid-js';
import type { Article } from '../../lib/library';
import { Button } from '../atoms/button';
import { IconButton } from '../atoms/icon-button';
import { ReaderIcon, ReadStatusIcon } from '../atoms/reader-icon';
import { ArticleFrame, WebpageFrame } from '../molecules/article-frame';
import { PopoverMenu } from '../molecules/popover-menu';
import { ReaderSourceLink, ReaderTitle } from './article-reader-actions';

export type LibraryReaderMode = 'original' | 'extracted' | 'webpage';

const modes: readonly {
  readonly value: LibraryReaderMode;
  readonly label: string;
}[] = [
  { value: 'original', label: '原文' },
  { value: 'extracted', label: '提取正文' },
  { value: 'webpage', label: '网页' },
];

const hasText = (value: string | undefined): boolean => (value ?? '') !== '';

const useReaderMode = (
  article: () => Article,
  onExtract: (article: Article) => Promise<Article | undefined>
) => {
  const [mode, setMode] = createSignal<LibraryReaderMode>('original');
  const [extracting, setExtracting] = createSignal(false);
  let run = 0;
  createEffect(
    on(
      () => article().id,
      () => {
        run += 1;
        setMode('original');
        setExtracting(false);
      }
    )
  );
  const hasUrl = () => hasText(article().url);
  const hasExtracted = () => hasText(article().extractedContent);
  const pick = async (next: LibraryReaderMode) => {
    if (next === mode() || !hasUrl()) return;
    if (next !== 'extracted' || hasExtracted()) {
      setMode(next);
      return;
    }

    const token = ++run;
    setExtracting(true);
    const updated = await onExtract(article());
    if (token !== run) return;

    setExtracting(false);
    if (updated !== undefined) setMode('extracted');
  };

  return { mode, extracting, hasUrl, hasExtracted, pick };
};

type ReaderModeView = ReturnType<typeof useReaderMode>;

const modeDisabled = (value: LibraryReaderMode, view: ReaderModeView) =>
  value !== 'original' && !view.hasUrl();

const ModeSwitch = (props: { readonly view: ReaderModeView }) => (
  <fieldset class="m-0 flex min-w-0 items-center gap-1 border-0 p-0">
    <legend class="sr-only">正文来源</legend>
    <For each={modes}>
      {(item) => (
        <Button
          type="button"
          class="btn btn-xs"
          classList={{
            'btn-neutral': props.view.mode() === item.value,
            'btn-ghost': props.view.mode() !== item.value,
          }}
          aria-pressed={props.view.mode() === item.value}
          disabled={
            props.view.extracting() || modeDisabled(item.value, props.view)
          }
          onClick={() => void props.view.pick(item.value)}
        >
          {item.label}
        </Button>
      )}
    </For>
    <Show when={props.view.extracting()}>
      <span class="loading loading-spinner loading-xs" aria-hidden="true" />
      <span class="text-xs text-base-content/60" role="status">
        正在提取正文…
      </span>
    </Show>
  </fieldset>
);

const readableHtml = (
  article: Article,
  mode: LibraryReaderMode
): string | undefined =>
  mode === 'extracted'
    ? article.extractedContent
    : (article.content ?? article.description);

const ReaderHtml = (props: { readonly html: string | undefined }) => (
  <Show
    when={props.html}
    fallback={
      <p class="rounded-box border border-dashed border-base-300 bg-base-200/40 px-6 py-12 text-center text-sm leading-relaxed text-base-content/70">
        暂无内容
      </p>
    }
  >
    {(html) => <ArticleFrame html={html()} />}
  </Show>
);

const ReaderDocument = (props: {
  readonly article: Article;
  readonly view: ReaderModeView;
}) => (
  <div class="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
    <div class="mx-auto flex max-w-208 flex-col gap-4 px-6 py-8 max-sm:px-4 max-sm:py-6">
      <ReaderTitle title={props.article.title} url={props.article.url ?? ''} />
      <Show when={props.article.url}>
        {(url) => <ReaderSourceLink url={url()} />}
      </Show>
      <ModeSwitch view={props.view} />
      <ReaderHtml html={readableHtml(props.article, props.view.mode())} />
    </div>
  </div>
);

type ReaderPaneProps = {
  readonly article: Article;
  readonly pending: boolean;
  readonly previous: Article | undefined;
  readonly next: Article | undefined;
  readonly onBack: () => void;
  readonly onOpen: (article: Article) => void;
  readonly onToggleRead: (article: Article) => void;
  readonly onSave: (article: Article) => void;
  readonly onRemove: (article: Article) => void;
  readonly onExtract: (article: Article) => Promise<Article | undefined>;
};

const ReaderOverflow = (props: { readonly pane: ReaderPaneProps }) => (
  <PopoverMenu
    label="更多文章操作"
    trigger={(target) => (
      <IconButton popoverTarget={target} label="更多操作">
        <ReaderIcon name="more" />
      </IconButton>
    )}
  >
    {(close) => (
      <>
        <Show when={props.pane.article.url}>
          {(url) => (
            <li>
              <a
                href={url()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
              >
                <ReaderIcon name="external" />
                打开原文
              </a>
            </li>
          )}
        </Show>
        <Show when={props.pane.article.feedId === undefined}>
          <li>
            <Button
              type="button"
              class="text-error"
              disabled={props.pane.pending}
              onClick={() => {
                close();
                props.pane.onRemove(props.pane.article);
              }}
            >
              <ReaderIcon name="delete" />
              删除
            </Button>
          </li>
        </Show>
      </>
    )}
  </PopoverMenu>
);

const StepButton = (props: {
  readonly label: string;
  readonly icon: 'previous' | 'next';
  readonly target: Article | undefined;
  readonly onOpen: (article: Article) => void;
}) => (
  <IconButton
    label={props.label}
    disabled={props.target === undefined}
    onClick={() => {
      if (props.target !== undefined) props.onOpen(props.target);
    }}
  >
    <ReaderIcon name={props.icon} />
  </IconButton>
);

const ReaderHeader = (props: { readonly pane: ReaderPaneProps }) => (
  <nav
    aria-label="文章操作"
    class="z-10 flex h-13 shrink-0 items-center gap-1 border-b border-base-300 bg-base-100 px-4 max-sm:px-2"
  >
    <IconButton label="返回文章列表" onClick={props.pane.onBack}>
      <ReaderIcon name="back" />
    </IconButton>
    <StepButton
      label="上一篇"
      icon="previous"
      target={props.pane.previous}
      onOpen={props.pane.onOpen}
    />
    <StepButton
      label="下一篇"
      icon="next"
      target={props.pane.next}
      onOpen={props.pane.onOpen}
    />
    <div class="ms-auto flex items-center gap-1">
      <Show when={props.pane.article.feedId !== undefined}>
        <IconButton
          label="保存到稍后阅读"
          disabled={props.pane.pending}
          onClick={() => props.pane.onSave(props.pane.article)}
        >
          <ReaderIcon name="bookmark" />
        </IconButton>
      </Show>
      <IconButton
        label={props.pane.article.read ? '标为未读' : '标为已读'}
        disabled={props.pane.pending}
        onClick={() => props.pane.onToggleRead(props.pane.article)}
      >
        <ReadStatusIcon read={props.pane.article.read} class="size-4.5" />
      </IconButton>
      <ReaderOverflow pane={props.pane} />
    </div>
  </nav>
);

const ReaderPane = (props: ReaderPaneProps) => {
  const view = useReaderMode(() => props.article, props.onExtract);
  const webpage = () => view.mode() === 'webpage' && view.hasUrl();

  return (
    <section class="m-0 flex h-full min-h-0 w-full flex-col">
      <ReaderHeader pane={props} />
      <Show
        when={webpage()}
        fallback={<ReaderDocument article={props.article} view={view} />}
      >
        <WebpageFrame url={props.article.url ?? ''} />
      </Show>
    </section>
  );
};

const ReaderEmpty = () => (
  <div class="grid h-full place-items-center px-6 text-center">
    <div class="flex flex-col items-center gap-4">
      <ReaderIcon name="reading" class="size-10 text-base-content/25" />
      <p class="text-sm text-base-content/60">未选择文章</p>
      <p class="text-xs text-base-content/60">从左侧选择一篇文章，开始阅读</p>
    </div>
  </div>
);

type LibraryReaderProps = Omit<ReaderPaneProps, 'article'> & {
  readonly article: Article | undefined;
};

export const LibraryReader = (props: LibraryReaderProps) => (
  <Show when={props.article} fallback={<ReaderEmpty />}>
    {(article) => (
      <ReaderPane
        article={article()}
        pending={props.pending}
        previous={props.previous}
        next={props.next}
        onBack={props.onBack}
        onOpen={props.onOpen}
        onToggleRead={props.onToggleRead}
        onSave={props.onSave}
        onRemove={props.onRemove}
        onExtract={props.onExtract}
      />
    )}
  </Show>
);
