import type { ParentProps } from 'solid-js';

export const CenteredLayout = (props: ParentProps) => (
  <main class="flex min-h-screen items-center justify-center bg-base-200 p-6 text-base-content">
    {props.children}
  </main>
);
