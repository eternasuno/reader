import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { savedPageMessages as copy } from './messages';
import { cancelRemoval, confirmRemoval, pendingRemoval } from './remove';

/**
 * The confirmation before removing a saved page (later.md Removing a saved page,
 * RD-DELETE-2): the question, and one destructive confirm. Esc and the close
 * button cancel, because cancelling is what every close without the confirm
 * does; no success toast follows the removal.
 */
export const RemoveSavedPageDialog = () => (
  <Dialog
    open={pendingRemoval() !== undefined}
    label={copy.removeAction}
    onClose={cancelRemoval}
  >
    <h2 class="py-2 text-base font-semibold tracking-tight">
      {copy.removeQuestion}
    </h2>
    <div class="flex justify-end pt-4">
      <Button
        type="button"
        variant="solid"
        class="btn btn-error whitespace-nowrap"
        onClick={() => void confirmRemoval()}
      >
        {copy.removeAction}
      </Button>
    </div>
  </Dialog>
);
