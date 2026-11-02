import { type JSX, Show, splitProps } from 'solid-js';
import { Button } from './button';

type NavButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly active?: boolean;
};

export const NavButton = (props: NavButtonProps) => {
  const [local, rest] = splitProps(props, ['class', 'active']);

  return (
    <Button
      {...rest}
      type="button"
      aria-current={local.active ? 'page' : undefined}
      class={`flex min-h-9 cursor-pointer items-center px-2.5 py-2 text-left aria-[current=page]:bg-neutral aria-[current=page]:text-neutral-content max-sm:min-h-11 pointer-coarse:min-h-11 ${local.class ?? ''}`}
    />
  );
};

export const UnreadCount = (props: {
  readonly count: number | undefined;
  readonly active?: boolean;
}) => (
  <Show when={(props.count ?? 0) > 0}>
    <span
      class="ml-auto shrink-0 text-xs tabular-nums text-base-content/65 data-[active=true]:text-neutral-content/80"
      data-active={props.active}
      title={`${props.count} 篇未读文章`}
    >
      {props.count}
      <span class="sr-only"> 篇未读文章</span>
    </span>
  </Show>
);
