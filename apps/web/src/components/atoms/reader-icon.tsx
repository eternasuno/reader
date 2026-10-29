import type { JSX } from 'solid-js';

const paths = {
  bookmark: 'M7 3.5h10a1 1 0 0 1 1 1v16L12 17l-6 3.5v-16a1 1 0 0 1 1-1Z',
  all: 'M8.5 8.5c-2-2-5.5-.5-5.5 3.5s3.5 5.5 5.5 3.5l7-7c2-2 5.5-.5 5.5 3.5s-3.5 5.5-5.5 3.5Z',
  feed: 'M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M6 19a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
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
    'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Zm0 0v5h5M9 13h6M9 17h6',
  reading:
    'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm9 3a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2',
  square:
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
  squareCheck:
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 9 3 3 7-7',
  checks: 'm2 12 5 5L17 7m-6 10 10-10',
  markAbove: 'm2 12 5 5L18 6m0 14v-8m-3 3 3-3 3 3',
  refresh: 'M20 7v5h-5m5 0a8 8 0 1 0-2.3 5.7',
  external:
    'M14 4h6v6m0-6L10 14M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
  more: 'M13.5 5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm0 7a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z',
  delete: 'M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6m4-6v6',
} as const;

export const ReadStatusIcon = (props: {
  readonly read: boolean;
  readonly class?: string;
}) => (
  <span
    class={`shrink-0 rounded-full border ${props.class ?? 'size-2'}`}
    classList={{
      'border-current opacity-70': props.read,
      'border-primary bg-primary': !props.read,
    }}
    aria-hidden="true"
  />
);

export const ReaderIcon = (props: {
  name: keyof typeof paths;
  class?: string;
}): JSX.Element => (
  <svg
    class={`inline-block shrink-0 ${props.class ?? 'size-5'}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path
      d={paths[props.name]}
      fill={props.name === 'more' ? 'currentColor' : 'none'}
      stroke={props.name === 'more' ? 'none' : undefined}
    />
  </svg>
);
