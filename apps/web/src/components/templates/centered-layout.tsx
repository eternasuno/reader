import type { ParentProps } from 'solid-js';

export const CenteredLayout = (props: ParentProps) => (
  <main class="flex min-h-screen items-center justify-center p-4">
    {props.children}
  </main>
);
