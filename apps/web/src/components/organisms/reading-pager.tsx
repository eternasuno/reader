import { Show } from 'solid-js';

type ReadingPagerProps = {
  page: number;
  pending: boolean;
  hasMore: boolean | undefined;
  onPrevious: () => void;
  onNext: () => void;
};

export const ReadingPager = (props: ReadingPagerProps) => (
  <Show when={props.page > 0 || props.hasMore}>
    <nav class="reading-pager" aria-label="清单分页">
      <button
        class="btn btn-ghost btn-sm text-base-content/60"
        type="button"
        disabled={props.page === 0 || props.pending}
        onClick={props.onPrevious}
      >
        上一页
      </button>
      <span>第 {props.page + 1} 页</span>
      <button
        class="btn btn-ghost btn-sm text-base-content/60"
        type="button"
        disabled={!props.hasMore || props.pending}
        onClick={props.onNext}
      >
        下一页
      </button>
    </nav>
  </Show>
);
