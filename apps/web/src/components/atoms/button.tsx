import { type JSX, splitProps } from 'solid-js';

type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: 'solid';
};

export const Button = (props: ButtonProps) => {
  const [local, rest] = splitProps(props, ['class', 'variant']);

  return (
    <button
      type="button"
      {...rest}
      class={`cursor-pointer rounded-md! transition-[background-color,box-shadow] enabled:hover:shadow-md! disabled:cursor-not-allowed ${local.variant === 'solid' ? '' : 'enabled:hover:border-transparent! enabled:hover:bg-base-content/8!'} ${local.class ?? ''}`}
    />
  );
};
