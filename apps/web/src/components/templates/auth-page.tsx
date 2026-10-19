import type { ParentProps } from 'solid-js';
import { CenteredLayout } from './centered-layout';

export const AuthPage = (props: ParentProps<{ title: string }>) => (
  <CenteredLayout>
    <section class="card card-border w-full max-w-sm border-base-300 bg-base-100 text-base-content shadow-sm">
      <div class="card-body gap-6">
        <p class="text-sm tracking-widest text-base-content/60">稍后阅读</p>
        <h1 class="card-title text-2xl font-medium">{props.title}</h1>
        {props.children}
      </div>
    </section>
  </CenteredLayout>
);
