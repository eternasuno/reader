import type { JSX } from 'solid-js';

const paths = {
  bookmark: 'M7 3.5h10a1 1 0 0 1 1 1v16L12 17l-6 3.5v-16a1 1 0 0 1 1-1Z',
  all: 'M8.5 8.5c-2-2-5.5-.5-5.5 3.5s3.5 5.5 5.5 3.5l7-7c2-2 5.5-.5 5.5 3.5s-3.5 5.5-5.5 3.5Z',
  feed: 'M5 10.5A8.5 8.5 0 0 1 13.5 19M5 4.5A14.5 14.5 0 0 1 19.5 19M5 18.5v.5',
  plus: 'M12 5v14M5 12h14',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  user: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM6.5 18a5.5 5.5 0 0 1 11 0',
  logout: 'M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M10 12h10m-4-4 4 4-4 4',
  close: 'm6.5 6.5 11 11m-11 0 11-11',
  menu: 'M5 6h14M5 12h14M5 18h14',
  back: 'M19 12H5m6-6-6 6 6 6',
  previous: 'm6.5 14.5 5.5-5.5 5.5 5.5',
  next: 'm6.5 9.5 5.5 5.5 5.5-5.5',
  extract:
    'M5 8h12v8a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V8Zm12 0h1.5a3.5 3.5 0 0 1 0 7H17M7 3v2m4-2v2m4-2v2',
  check: 'm5 12.5 4.5 4.5L19 7',
  refresh:
    'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17',
  external:
    'M14 4h6v6m0-6L10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  more: 'M12 4.5v.5m0 6.75v.5m0 6.75v.5',
  delete: 'M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6m4-6v6',
} as const;

export const ReadStatusIcon = (props: {
  readonly read: boolean;
  readonly class?: string;
}) => (
  <span
    class={`rounded-full border border-current opacity-70 ${props.class ?? 'size-2'}`}
    classList={{ 'bg-current': !props.read }}
    aria-hidden="true"
  />
);

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
