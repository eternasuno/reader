import type { JSX } from 'solid-js';

const paths = {
  bookmark: 'M6 3h12v18l-6-4-6 4V3Z',
  all: 'M9 8c-5-6-11 6-5 8 4 2 7-10 11-8 6 2 0 14-5 8',
  feed: 'M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14M5 19h.01',
  plus: 'M12 5v14M5 12h14',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  logout: 'M9 4H4v16h5M10 12h11M17 8l4 4-4 4',
  close: 'm6 6 12 12M6 18 18 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  back: 'M19 12H5m7-7-7 7 7 7',
  extract: 'M8 3H5v18h14V3h-3M9 3h6v4H9V3Zm-1 9h8m-8 4h6',
  read: 'm5 12 4 4L19 6',
  unread: 'M4 6h16v12H4V6Zm0 0 8 7 8-7',
  external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  more: 'M12 5h.01M12 12h.01M12 19h.01',
  delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
} as const;

export const ReaderIcon = (props: {
  name: keyof typeof paths;
  class?: string;
}): JSX.Element => (
  <svg
    class={props.class}
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d={paths[props.name]} />
  </svg>
);
