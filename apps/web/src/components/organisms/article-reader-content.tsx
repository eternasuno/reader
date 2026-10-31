import { AsyncResult } from 'effect/reactivity';
import { Show } from 'solid-js';
import { Button } from '../atoms/button';
import { ArticleFrame } from '../molecules/article-frame';
import type { ReaderItem, ReaderStores } from './article-reader-model';
import { toReaderSource } from './article-reader-model';

const ReaderEmpty = () => (
  <div class="rounded-box border border-dashed border-base-300 bg-base-200/40 px-6 py-12 text-center">
    <p class="text-sm leading-relaxed text-base-content/70">
      暂无 RSS
      内容或正文缓存。点击提取正文会调用已配置的正文提取服务，之后优先读取缓存。
    </p>
  </div>
);

const ReaderFailure = (props: { onRetry: () => void }) => (
  <div
    class="rounded-box border border-base-200 bg-base-200/40 px-6 py-12 text-center"
    role="alert"
  >
    <p class="text-sm leading-relaxed text-base-content/70">
      正文缓存加载失败，请重试。
    </p>
    <Button
      type="button"
      class="btn btn-ghost btn-sm mt-4 min-h-9"
      onClick={props.onRetry}
    >
      重试
    </Button>
  </div>
);

const ReaderLoading = () => (
  <div
    class="flex items-center justify-center gap-3 px-6 py-12 text-sm text-base-content/60"
    role="status"
  >
    <span class="loading loading-spinner loading-sm" aria-hidden="true" />
    正在加载正文缓存…
  </div>
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
