import { Show } from 'solid-js';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { FolderSelect } from './folder-select';
import {
  closeMoveFeed,
  moveFeedToFolder,
  moveTarget,
  movingFeed,
  setMoveTarget,
} from './move';

/**
 * `移动到目录`: one feed, one `目录` select, preselecting the feed's folder.
 * Moving is a quick action (Client conventions), so the select and the button
 * stay enabled and the button keeps its `移动` label while a request runs.
 */
export const MoveFeedDialog = () => (
  <Dialog
    open={movingFeed() !== undefined}
    label="移动到目录"
    onClose={closeMoveFeed}
  >
    <section class="py-2">
      <h2 class="text-lg font-semibold tracking-tight">移动到目录</h2>
      <Show when={movingFeed()}>
        {(feed) => (
          <p class="mt-2 text-sm text-base-content/60">
            将「{feed().title}」移动到：
          </p>
        )}
      </Show>
      <form
        class="mt-2"
        onSubmit={(event) => {
          event.preventDefault();
          void moveFeedToFolder();
        }}
      >
        <FolderSelect
          id="move-folder"
          value={moveTarget()}
          onChange={setMoveTarget}
        />
        <Button type="submit" variant="solid">
          移动
        </Button>
      </form>
    </section>
  </Dialog>
);
