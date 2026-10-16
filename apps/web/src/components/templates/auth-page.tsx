import type { ParentProps } from 'solid-js';
import { CenteredLayout } from './centered-layout';

export const AuthPage = (props: ParentProps<{ title: string }>) => (
  <CenteredLayout>
    <section class="card card-border w-full max-w-md">
      <div class="card-body">
        <h1 class="card-title">{props.title}</h1>
        {props.children}
      </div>
    </section>
  </CenteredLayout>
);
