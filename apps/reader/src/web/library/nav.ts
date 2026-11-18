import { createSignal } from 'solid-js';

/**
 * Whether the small screen's navigation is open (LIB-VIEW-2): the mobile bar
 * toggles it and selecting a scope closes it.
 */
const [navOpen, setNavOpen] = createSignal(false);

export { navOpen };

export const toggleNav = (): void => {
  setNavOpen((open) => !open);
};

export const closeNav = (): void => {
  setNavOpen(false);
};
