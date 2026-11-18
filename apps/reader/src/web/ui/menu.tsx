import { createUniqueId, type JSX } from 'solid-js';

export type MenuProps = {
  /** The accessible name of the popover. */
  readonly label: string;
  /** Renders the trigger; it must carry `popovertarget={target}`. */
  readonly trigger: (target: string) => JSX.Element;
  /** The menu's items; `close` hides the popover before an action runs. */
  readonly children: (close: () => void) => JSX.Element;
};

/**
 * The shared popover menu: a native `popover="auto"` list opened by its trigger,
 * so Esc, light dismiss and focus handling are the platform's. A dialog opened
 * from a menu item closes the menu first (ui.md: `Dialog`).
 */
export const Menu = (props: MenuProps) => {
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
