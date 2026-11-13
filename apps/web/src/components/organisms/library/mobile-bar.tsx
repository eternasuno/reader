import { Button } from '../../atoms/button';
import { ReaderIcon } from '../../atoms/reader-icon';
import { LibraryAccountMenu } from './account-menu';

export const LibraryMobileBar = (props: {
  readonly navOpen: boolean;
  readonly title: string;
  readonly onToggle: () => void;
}) => (
  <div class="hidden items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-2 max-sm:flex">
    <Button
      type="button"
      class="grid size-11 cursor-pointer place-items-center"
      aria-label="切换导航"
      aria-expanded={props.navOpen}
      onClick={props.onToggle}
    >
      <ReaderIcon name={props.navOpen ? 'close' : 'menu'} />
    </Button>
    <span>
      留白 <span class="text-base-content/40">/ {props.title}</span>
    </span>
    <LibraryAccountMenu />
  </div>
);
