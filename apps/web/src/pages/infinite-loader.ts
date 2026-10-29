import type { Accessor } from 'solid-js';
import type { InfiniteState } from '../lib/infinite';

export const useInfiniteLoader = <T>(
  state: Accessor<InfiniteState<T>>,
  pending: Accessor<boolean>,
  loadPage: (reset: boolean) => Promise<unknown>
) => {
  let loadingMore = false;
  const runPage = async (reset: boolean) => {
    try {
      await loadPage(reset);
    } catch {
      // Load failures are recorded in the shared infinite state.
    }
  };
  const reload = () => {
    void runPage(true);
  };
  const requestMore = () => {
    if (loadingMore) return;

    loadingMore = true;
    void runPage(false).finally(() => {
      loadingMore = false;
    });
  };
  const loadMore = () => {
    const current = state();
    if (current.error || current.loading || !current.hasMore || pending())
      return;

    requestMore();
  };
  const retry = () => {
    const current = state();
    if (current.loading) return;

    if (current.initialized) requestMore();
    else reload();
  };

  return { loadMore, reload, retry };
};
