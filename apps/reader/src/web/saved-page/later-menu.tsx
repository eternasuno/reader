import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { openAddLink } from './add-link';
import { savedPageMessages as copy } from './messages';

/**
 * The extra items of the `稍后阅读` scope's menus (LIB-MENU, later.md Interface):
 * its sidebar row and its article-list overflow menu both offer the add action,
 * and no other scope has one. `close` hides the menu before the dialog opens.
 */
export const LaterMenuItems = (props: { readonly close: () => void }) => (
  <li class="mt-2 border-t border-base-300 pt-2">
    <Button
      type="button"
      onClick={() => {
        props.close();
        openAddLink();
      }}
    >
      <Icon name="plus" />
      {copy.addTitle}
    </Button>
  </li>
);
