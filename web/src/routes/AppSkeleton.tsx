import type { JSX } from '@solidjs/web';
import { For } from 'solid-js';
import { ArticleListLoading } from '../components/ArticleListStates';
import { ReaderSkeleton } from '../components/ReaderView';
import { COLLAPSED_GRID_CLASSES, GRID_CLASSES } from './LibraryPanels';

const SIDEBAR_ROW_WIDTHS = [
  'w-20',
  'w-24',
  'w-16',
  'w-28',
  'w-24',
  'w-32',
  'w-20',
  'w-28',
];

function SidebarSkeleton(props: { collapsed: boolean }): JSX.Element {
  return (
    <div
      class={[
        'flex h-full min-h-0 flex-col gap-1 overflow-hidden border-r border-base-300 px-2 py-3 max-md:hidden',
        // Keep the zero-width first grid track occupied so the panes stay in their columns.
        { invisible: props.collapsed },
      ]}
    >
      <div class="flex items-center gap-2.5 px-2 pb-3">
        <div class="skeleton size-6 rounded-full" />
        <div class="skeleton h-5 w-20" />
      </div>
      <For each={SIDEBAR_ROW_WIDTHS}>
        {(width) => (
          <div class="flex items-center gap-2.5 px-2 py-2">
            <div class="skeleton size-4 rounded-full" />
            <div class={['skeleton h-3.5', width]} />
          </div>
        )}
      </For>
    </div>
  );
}

export interface AppSkeletonProps {
  label: string;
  /** The route opens an article, so compact layouts show the reader instead of the list. */
  articleOpen: boolean;
  /** The saved desktop sidebar state (`reader.sidebarCollapsed`). */
  sidebarCollapsed: boolean;
}

/**
 * Loading placeholder shaped like the library layout (`LibraryPanels`: same grid columns, the
 * same panes visible at each breakpoint), shown while the session is verified.
 */
export function AppSkeleton(props: AppSkeletonProps): JSX.Element {
  return (
    <div
      role="status"
      aria-label={props.label}
      class={[
        props.sidebarCollapsed ? COLLAPSED_GRID_CLASSES : GRID_CLASSES,
        'h-dvh overflow-hidden bg-base-100',
      ]}
    >
      <SidebarSkeleton collapsed={props.sidebarCollapsed} />
      <div
        aria-hidden="true"
        class={[
          'min-h-0 flex-col border-base-300 md:border-r',
          props.articleOpen ? 'hidden lg:flex' : 'flex',
        ]}
      >
        <div class="flex min-h-13 items-center gap-2 border-b border-base-300 px-3 py-1.5">
          <div class="skeleton h-5 w-28" />
          <span class="flex-1" />
          <div class="skeleton size-8 rounded-field" />
        </div>
        <ArticleListLoading grouped label={props.label} />
      </div>
      <div
        aria-hidden="true"
        class={['min-h-0', props.articleOpen ? 'flex' : 'hidden lg:flex']}
      >
        <ReaderSkeleton label={props.label} />
      </div>
    </div>
  );
}
