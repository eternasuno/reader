import type { SettingsSection } from './section';

/**
 * Which way `/settings` lays its navigation out: beside the sections, or stacked
 * above them. It is decided by measuring the two areas, never by a screen-width
 * breakpoint (ui.md, settings.md Interface).
 */
export type SettingsLayout = 'beside' | 'stacked';

/**
 * Whether a section is on screen. Every section stays mounted in both layouts —
 * a layout change only hides or shows it, so no draft is discarded and no write
 * is released (settings.md Interface). Beside the sections only the open one is
 * shown; stacked all four are, in page order.
 */
export const sectionShown = (
  layout: SettingsLayout,
  open: SettingsSection,
  section: SettingsSection
): boolean => layout === 'stacked' || section === open;

/** What a measurement of one area tells about the layout. */
export type Area = {
  readonly width: number;
  readonly left: number;
  readonly right: number;
};

/** Side by side when both are laid out and the navigation ends before the sections. */
export const layoutOf = (navigation: Area, sections: Area): SettingsLayout =>
  navigation.width > 0 &&
  sections.width > 0 &&
  navigation.right <= sections.left + 1
    ? 'beside'
    : 'stacked';

const areaOf = (element: HTMLElement): Area => element.getBoundingClientRect();

/**
 * Reports the layout whenever either area changes size; the sections area grows
 * to the full width when it wraps below the navigation, so its size follows the
 * wrap. The returned function stops watching.
 */
export const observeLayout = (
  navigation: HTMLElement,
  sections: HTMLElement,
  update: (layout: SettingsLayout) => void
): (() => void) => {
  const read = (): void => {
    update(layoutOf(areaOf(navigation), areaOf(sections)));
  };
  const observer = new ResizeObserver(read);

  observer.observe(navigation);
  observer.observe(sections);
  read();

  return () => {
    observer.disconnect();
  };
};
