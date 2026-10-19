import { type JSX, splitProps } from 'solid-js';

export const Button = (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => {
  const [local, rest] = splitProps(props, ['class']);

  return (
    <button
      type="button"
      {...rest}
      class={`cursor-pointer rounded-md! transition-[background-color,box-shadow] enabled:hover:border-transparent! enabled:hover:bg-base-content/8! enabled:hover:shadow-md! disabled:cursor-not-allowed ${local.class ?? ''}`}
    />
  );
};
