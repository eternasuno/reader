import { Option } from 'effect';
import { Show } from 'solid-js';
import type { Article } from '../../lib/library';
import {
  type LibraryReaderMode,
  useReaderMode,
} from '../../pages/library-reader-mode';
import { Button } from '../atoms/button';
import { IconButton } from '../atoms/icon-button';
import { MenuCheckbox } from '../atoms/menu-checkbox';
import { ReaderIcon, ReadStatusIcon } from '../atoms/reader-icon';
import { ArticleFrame, WebpageFrame } from '../molecules/article-frame';
import { PopoverMenu } from '../molecules/popover-menu';
import { ReaderSourceLink, ReaderTitle } from './article-reader-actions';

type ReaderModeView = ReturnType<typeof useReaderMode>;

const WebpageOption = (props: {
  readonly view: ReaderModeView;
  readonly onClose: () => void;
}) => (
  <li>
    <MenuCheckbox
      label="嵌入式网页视图"
      checked={props.view.mode() === 'webpage'}
      disabled={props.view.extracting() || !props.view.hasUrl()}
      onChange={(checked) => {
        props.onClose();
        void props.view.pick(checked ? 'webpage' : 'original');
      }}
    />
  </li>
);

const ExtractAction = (props: { readonly view: ReaderModeView }) => (
  <div class="flex shrink-0 items-center">
    <IconButton
      label={props.view.mode() === 'extracted' ? '切换回原文' : '提取正文'}
      pressed={props.view.mode() === 'extracted'}
      disabled={props.view.extracting() || !props.view.hasUrl()}
      busy={props.view.extracting()}
      onClick={() =>
        void props.view.pick(
          props.view.mode() === 'extracted' ? 'original' : 'extracted'
        )
      }
    >
      <Show
        when={!props.view.extracting()}
        fallback={
          <span class="loading loading-spinner loading-xs" aria-hidden="true" />
        }
      >
        <ReaderIcon
          name={props.view.mode() === 'extracted' ? 'extractFilled' : 'extract'}
          class={`size-5 ${props.view.mode() === 'extracted' ? 'text-primary' : ''}`}
        />
      </Show>
    </IconButton>
    <Show when={props.view.extracting()}>
      <span role="status" class="sr-only">
        正在提取正文…
      </span>
    </Show>
  </div>
);

const readableHtml = (
  article: Article,
  mode: LibraryReaderMode
): string | undefined => {
  const content = Option.getOrUndefined(article.content);

  return mode === 'extracted'
    ? Option.getOrUndefined(article.extractedContent)
    : (content ?? Option.getOrUndefined(article.description));
};

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
      <ReaderTitle
        title={props.article.title}
        url={Option.getOrUndefined(props.article.url) ?? ''}
      />
      <Show when={Option.getOrUndefined(props.article.url)}>
        {(url) => <ReaderSourceLink url={url()} />}
      </Show>
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

const ReaderOverflow = (props: {
  readonly pane: ReaderPaneProps;
  readonly view: ReaderModeView;
}) => (
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
        <WebpageOption view={props.view} onClose={close} />
        <Show when={Option.getOrUndefined(props.pane.article.url)}>
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
        <Show when={Option.isNone(props.pane.article.feedId)}>
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

const ReaderHeader = (props: {
  readonly pane: ReaderPaneProps;
  readonly view: ReaderModeView;
}) => (
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
      <Show when={Option.isSome(props.pane.article.feedId)}>
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
      <ExtractAction view={props.view} />
      <ReaderOverflow pane={props.pane} view={props.view} />
    </div>
  </nav>
);

const ReaderPane = (props: ReaderPaneProps) => {
  const view = useReaderMode(() => props.article, props.onExtract);
  const webpage = () => view.mode() === 'webpage' && view.hasUrl();

  return (
    <section class="m-0 flex h-full min-h-0 w-full flex-col">
      <ReaderHeader pane={props} view={view} />
      <Show
        when={webpage()}
        fallback={<ReaderDocument article={props.article} view={view} />}
      >
        <WebpageFrame url={Option.getOrUndefined(props.article.url) ?? ''} />
      </Show>
    </section>
  );
};

const ReaderEmpty = () => (
  <div class="grid h-full place-items-center bg-base-100/30 px-6 text-center">
    <div class="flex flex-col items-center gap-4">
      <ReaderIcon name="reading" class="size-10 text-base-content/25" />
      <p class="text-xl font-medium text-base-content/80">给阅读留一点空间</p>
      <p class="text-sm leading-relaxed text-base-content/60">
        从左侧选择一篇文章，开始阅读
      </p>
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
