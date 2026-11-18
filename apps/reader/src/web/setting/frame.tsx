import { A } from '@solidjs/router';
import type { JSX } from 'solid-js';
import { settingMessages as copy } from './messages';

/** The page header: heading, subtitle and the way back to the library. */
export const SettingsHeader = () => (
  <header class="flex items-start justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">{copy.heading}</h1>
      <p class="mt-1 text-sm text-base-content/60">{copy.subtitle}</p>
    </div>
    <A href="/later" class="link shrink-0 text-sm">
      {copy.backToLibrary}
    </A>
  </header>
);

export type SettingsFrameProps = {
  readonly navigation: JSX.Element;
  /** The sections area, which `layout.ts` measures against the navigation. */
  readonly sectionsRef: (element: HTMLElement) => void;
  readonly children: JSX.Element;
};

/**
 * The page's frame. The navigation stands beside the sections while the two fit
 * on one line and drops above them otherwise; `flex-wrap` makes that decision
 * from the measured widths, and `layout.ts` reads the result back, so no
 * breakpoint stands in for it (ui.md, settings.md Interface).
 */
export const SettingsFrame = (props: SettingsFrameProps) => (
  <main class="min-h-dvh bg-base-200 text-base-content">
    <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <SettingsHeader />
      <div class="flex flex-wrap items-start gap-6 lg:gap-10">
        {props.navigation}
        <div
          ref={props.sectionsRef}
          class="flex min-w-0 grow basis-80 flex-col gap-6"
        >
          {props.children}
        </div>
      </div>
    </div>
  </main>
);
