import { IconButton } from '../ui/button';
import { Icon } from '../ui/icon';
import { AccountMenu } from './account-menu';
import { copy } from './messages';
import { navOpen, toggleNav } from './nav';

/** The small screen's bar: the navigation toggle, the breadcrumb and the account. */
export const MobileBar = (props: { readonly name: string }) => (
  <div class="hidden items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-2 max-sm:flex">
    <IconButton
      label={copy.mobileToggle}
      expanded={navOpen()}
      onClick={toggleNav}
    >
      <Icon name={navOpen() ? 'close' : 'menu'} />
    </IconButton>
    <span>
      {copy.brand} <span class="text-base-content/40">/ {props.name}</span>
    </span>
    <AccountMenu />
  </div>
);
