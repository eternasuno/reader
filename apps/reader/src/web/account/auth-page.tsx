import type { JSX } from 'solid-js';
import { accountMessages } from './messages';

export type AuthPageProps = {
  /** The page title: `登录` or `注册`. */
  readonly title: string;
  readonly children: JSX.Element;
};

/** The centred card `/login` and `/register` show (account.md Interface). */
export const AuthPage = (props: AuthPageProps) => (
  <main class="flex min-h-screen items-center justify-center bg-base-200 p-6 text-base-content">
    <section class="card card-border w-full max-w-sm border-base-300 bg-base-100 text-base-content shadow-sm">
      <div class="card-body gap-6">
        <p class="text-sm tracking-widest text-base-content/60">
          {accountMessages.productLabel}
        </p>
        <h1 class="card-title text-2xl font-medium">{props.title}</h1>
        {props.children}
      </div>
    </section>
  </main>
);
