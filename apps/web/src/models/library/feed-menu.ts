import type { Feed, Folder, Scope } from '../../api/library';
import { feedsInFolder } from './folders';
import type { LibraryModel } from './model';
import { sameScope } from './state';

export const confirmUnsubscribe = (model: LibraryModel, feed: Feed) => {
  if (!window.confirm('取消订阅并删除该源的文章？已保存的稍后阅读不会删除。'))
    return;

  void model.unsubscribe(feed.id);
};

export const confirmRemoveFolder = (model: LibraryModel, folder: Folder) => {
  const count = feedsInFolder(model.state().feeds, folder.id).length;
  const message =
    count > 0
      ? `删除目录「${folder.name}」并取消订阅其中的 ${count} 个订阅源？这些源的文章会被删除，已保存的稍后阅读不会删除。`
      : `删除目录「${folder.name}」？`;

  if (!window.confirm(message)) return;

  void model.removeFolder(folder.id);
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
