import type { JSX } from '@solidjs/web';
import { createEffect } from 'solid-js';
import type { PanelName } from './LibraryPanels';
import { LibraryLayout } from './LibraryPanels';
import { createLibraryController } from './libraryController';
import type { PanelElements } from './viewHelpers';
import { recoverFocus } from './viewHelpers';

/**
 * `LIB-VIEW-1`, `LIB-RELOAD-1`, `RD-ARTICLE-1`: responsive three-panel library shell. The URL is
 * the source of truth for scope, open article, and the `?unread` filter; the controller owns the
 * reload/open effects and the layout keeps CSS-driven panel visibility.
 */
export function LibraryPage(): JSX.Element {
  const ctl = createLibraryController();
  const panels: PanelElements = {};

  const panelRef = (panel: PanelName, element: HTMLDivElement): void => {
    panels[panel] = element;
  };

  // `LIB-VIEW-1`: never strand keyboard focus inside a panel that CSS just hid.
  createEffect(
    () => ctl.routeState(),
    (state) => recoverFocus(state, panels)
  );

  return <LibraryLayout ctl={ctl} panelRef={panelRef} />;
}
