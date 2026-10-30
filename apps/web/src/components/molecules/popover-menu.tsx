import { createUniqueId, type JSX } from 'solid-js';

export const PopoverMenu = (props: {
  readonly label: string;
  readonly trigger: (target: string) => JSX.Element;
  readonly children: (close: () => void) => JSX.Element;
}) => {
  const id = createUniqueId();
  let menu!: HTMLUListElement;
  const close = () => menu.hidePopover();

  return (
    <>
      {props.trigger(id)}
      <ul
        ref={menu}
        id={id}
        popover="auto"
        aria-label={props.label}
        class="dropdown dropdown-end menu w-52 rounded-box bg-base-100 shadow-xl"
      >
        {props.children(close)}
      </ul>
    </>
  );
};
