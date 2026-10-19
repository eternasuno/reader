import { Show } from 'solid-js';
import { Button } from '../atoms/button';

type ReadingPagerProps = {
  page: number;
  pending: boolean;
  hasMore: boolean | undefined;
  onPrevious: () => void;
  onNext: () => void;
};

export const ReadingPager = (props: ReadingPagerProps) => (
  <Show when={props.page > 0 || props.hasMore}>
    <nav
      class="sticky bottom-0 z-2 flex min-h-11 items-center justify-between -mx-6 border-t border-base-300 bg-base-100 px-3 py-1 text-xs"
      aria-label="清单分页"
    >
      <Button
        class="btn btn-ghost btn-sm text-base-content/60"
        type="button"
        disabled={props.page === 0 || props.pending}
        onClick={props.onPrevious}
      >
        上一页
      </Button>
      <span>第 {props.page + 1} 页</span>
      <Button
        class="btn btn-ghost btn-sm text-base-content/60"
        type="button"
        disabled={!props.hasMore || props.pending}
        onClick={props.onNext}
      >
        下一页
      </Button>
    </nav>
  </Show>
);
