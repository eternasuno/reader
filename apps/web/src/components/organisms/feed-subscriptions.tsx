import type { FeedPreview } from '@reader/api';
import { Show } from 'solid-js';
import { Button } from '../atoms/button';
import { Input } from '../atoms/input';
import type { FeedReaderModel } from './feed-reader';

export const FeedSubscribeForm = (props: { model: FeedReaderModel }) => (
  <form
    class="flex flex-wrap items-center gap-2 pt-2"
    classList={{ hidden: props.model.preview() !== undefined }}
    onSubmit={(event) => {
      event.preventDefault();
      if (!props.model.previewPending()) {
        void props.model.fetchPreview(event.currentTarget);
      }
    }}
  >
    <label class="sr-only" for="feed-url">
      订阅地址
    </label>
    <Input
      class="min-w-0 flex-1"
      id="feed-url"
      name="url"
      type="url"
      required
      maxLength={4096}
      placeholder="RSS / Atom 订阅地址"
      aria-label="订阅地址"
      disabled={props.model.previewPending()}
    />
    <Button
      class="btn btn-neutral"
      variant="solid"
      type="submit"
      disabled={props.model.previewPending()}
      aria-busy={props.model.previewPending()}
    >
      {props.model.previewPending() ? '获取预览…' : '预览订阅'}
    </Button>
  </form>
);

const confirmLabel = (model: FeedReaderModel) => {
  if (model.confirmPending()) return '订阅中…';
  if (model.confirmError()) return '重试订阅';

  return '确认订阅';
};

const FeedPreviewPanel = (props: {
  model: FeedReaderModel;
  preview: FeedPreview;
}) => (
  <section
    aria-label="订阅确认"
    class="mt-2 rounded-box border border-base-content/20 p-3"
  >
    <h3 class="font-semibold tracking-tight">{props.preview.title}</h3>
    <Show when={props.preview.description}>
      <p class="mt-1 whitespace-pre-line text-sm text-base-content/70">
        {props.preview.description}
      </p>
    </Show>
    <p class="mt-1 break-all text-sm text-base-content/60">
      {props.preview.url}
    </p>
    <p class="mt-1 text-sm text-base-content/60">
      {props.preview.articleCount} 篇文章
    </p>
    <div class="mt-3 flex flex-wrap gap-2">
      <Button
        class="btn btn-neutral"
        variant="solid"
        type="button"
        disabled={props.model.confirmPending()}
        aria-busy={props.model.confirmPending()}
        onClick={() => void props.model.confirm()}
      >
        {confirmLabel(props.model)}
      </Button>
      <Button
        type="button"
        disabled={props.model.confirmPending()}
        onClick={props.model.edit}
      >
        修改
      </Button>
      <Button
        type="button"
        disabled={props.model.confirmPending()}
        onClick={props.model.cancel}
      >
        取消
      </Button>
    </div>
    <p class="mt-2 min-h-5 text-sm text-error" role="alert">
      {props.model.confirmError()}
    </p>
  </section>
);

export const FeedManagement = (props: { model: FeedReaderModel }) => {
  const failed = () => props.model.previewError() !== '';

  return (
    <section aria-label="添加订阅" class="py-2">
      <h2 class="text-lg font-semibold tracking-tight">添加订阅</h2>
      <p class="mt-2 text-sm text-base-content/60">
        添加 RSS 或 Atom 地址，订阅源每 30 分钟自动更新。
      </p>
      <FeedSubscribeForm model={props.model} />
      <Show when={props.model.preview()} keyed>
        {(preview) => (
          <FeedPreviewPanel model={props.model} preview={preview} />
        )}
      </Show>
      <Show when={props.model.preview() === undefined}>
        <p
          class="mt-2 min-h-5 text-sm"
          classList={{ 'text-error': failed(), 'text-success': !failed() }}
          role={failed() ? 'alert' : 'status'}
        >
          {props.model.previewError() || props.model.subscribeNotice()}
        </p>
      </Show>
    </section>
  );
};
