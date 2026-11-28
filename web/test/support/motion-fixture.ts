import { afterEach, beforeEach } from 'vitest';
import {
  createStateTestContext,
  makeFeed,
  makeItem,
  makePage,
  uuid,
} from './state-fixture';
import { deferViewTransitions } from './view-transition';

export const later = { kind: 'later' } as const;
export const B2 = uuid(900);
export const first = makePage({ id: uuid(1) });
export const second = makePage({ id: uuid(2) });
export const third = makePage({ id: uuid(3) });
export const folderId = uuid(20);
export const moved = makeFeed({ id: uuid(21), folderId });
export const stays = makeFeed({ id: uuid(22), folderId });
export const movedItem = makeItem({ id: uuid(31), feedId: moved.id });
export const staysItem = makeItem({ id: uuid(32), feedId: stays.id });

export const ctx = createStateTestContext();
export const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
let restoreTransitions: (() => void) | undefined;

export const motion = () => import('../../src/state/library-motion');
export const snapshotModule = () => import('../../src/state/library-snapshot');

export const loadLater = () =>
  ctx.queueLoadedLibrary({ scope: later, items: [second, first] });

export const loadFolder = () =>
  ctx.queueLoadedLibrary({
    scope: { kind: 'folder', folderId },
    items: [movedItem, staysItem],
    feeds: [moved, stays],
  });

/** Defers view transition updates until `runUpdate`; restored after each test. */
export const deferTransitions = () => {
  const deferred = deferViewTransitions(ctx.ui, nextTask);
  restoreTransitions = deferred.restore;
  return deferred.transition;
};

beforeEach(async () => {
  await ctx.reset();
});

afterEach(() => {
  restoreTransitions?.();
  restoreTransitions = undefined;
});
