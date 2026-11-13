import type { JSX } from 'solid-js';

export const SettingsLayout = (props: {
  readonly nav: JSX.Element;
  readonly panels: JSX.Element;
  readonly toast: JSX.Element;
  readonly contentRef: (element: HTMLDivElement) => void;
}) => (
  <main class="min-h-dvh bg-base-200 text-base-content">
    <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-10 lg:p-8">
      <header class="flex items-start justify-between gap-3 lg:col-span-2">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">设置</h1>
          <p class="mt-1 text-sm text-base-content/60">
            管理账号、文章保留与正文提取。
          </p>
        </div>
        <a href="/" class="link shrink-0 text-sm">
          返回阅读
        </a>
      </header>
      {props.nav}
      <div ref={props.contentRef} class="flex min-w-0 flex-col gap-6">
        {props.panels}
      </div>
    </div>
    {props.toast}
  </main>
);
