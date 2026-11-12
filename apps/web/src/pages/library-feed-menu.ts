import type { Feed, Scope } from '../lib/library';
import { type LibraryModel, sameScope } from './library-model';

export const confirmUnsubscribe = (model: LibraryModel, feed: Feed) => {
  if (!window.confirm('取消订阅并删除该源的文章？已保存的稍后阅读不会删除。'))
    return;

  void model.unsubscribe(feed.id);
};

export const createFeedMenu = (
  model: LibraryModel,
  onSelect: (scope: Scope) => void
) => {
  const selectScope = async (scope: Scope) => {
    onSelect(scope);
    await model.setScope(scope);

    return sameScope(model.state().scope, scope);
  };

  return {
    filter: async (scope: Scope, checked: boolean) => {
      if (await selectScope(scope)) {
        await model.setFilter(checked);
      }
    },
    markAll: async (scope: Scope) => {
      if (await selectScope(scope)) {
        await model.markAll();
      }
    },
  };
};
