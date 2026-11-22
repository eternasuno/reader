import type { JSX } from '@solidjs/web';
import { For } from 'solid-js';

export type IconName =
  | 'plus'
  | 'dots'
  | 'folder'
  | 'folder-open'
  | 'rss'
  | 'bookmark'
  | 'inbox'
  | 'settings'
  | 'check'
  | 'warning'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'circle'
  | 'circle-filled'
  | 'arrow-left'
  | 'external-link'
  | 'trash'
  | 'extract'
  | 'globe'
  | 'menu'
  | 'close'
  | 'mail'
  | 'refresh'
  | 'user';

export interface IconProps {
  name: IconName;
  size?: number | string;
  strokeWidth?: number;
  class?: string;
  /** Accessible name. Omit to render the icon as decorative (`aria-hidden`). */
  label?: string;
}

type IconShape =
  | { kind: 'path'; d: string }
  | { kind: 'circle'; cx: number; cy: number; r: number; filled?: boolean }
  | {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      rx?: number;
    };

const p = (d: string): IconShape => ({ kind: 'path', d });
const c = (cx: number, cy: number, r: number, filled = false): IconShape => ({
  kind: 'circle',
  cx,
  cy,
  r,
  filled,
});
const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  rx = 0
): IconShape => ({
  kind: 'rect',
  x,
  y,
  width,
  height,
  rx,
});

const SHAPES: Record<IconName, Array<IconShape>> = {
  plus: [p('M5 12h14'), p('M12 5v14')],
  dots: [c(5, 12, 1.4, true), c(12, 12, 1.4, true), c(19, 12, 1.4, true)],
  folder: [
    p(
      'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'
    ),
  ],
  'folder-open': [
    p(
      'm6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2'
    ),
  ],
  rss: [
    p('M4 11a9 9 0 0 1 9 9'),
    p('M4 4a16 16 0 0 1 16 16'),
    c(5, 19, 1, true),
  ],
  bookmark: [p('m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z')],
  inbox: [
    p('M22 12h-6l-2 3h-4l-2-3H2'),
    p(
      'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'
    ),
  ],
  settings: [
    p(
      'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z'
    ),
    c(12, 12, 3),
  ],
  check: [p('M20 6 9 17l-5-5')],
  warning: [
    p(
      'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'
    ),
    p('M12 9v4'),
    p('M12 17h.01'),
  ],
  'chevron-left': [p('m15 18-6-6 6-6')],
  'chevron-right': [p('m9 18 6-6-6-6')],
  'chevron-down': [p('m6 9 6 6 6-6')],
  'chevron-up': [p('m18 15-6-6-6 6')],
  circle: [c(12, 12, 7)],
  'circle-filled': [c(12, 12, 7, true)],
  'arrow-left': [p('m12 19-7-7 7-7'), p('M19 12H5')],
  'external-link': [
    p('M15 3h6v6'),
    p('M10 14 21 3'),
    p('M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'),
  ],
  trash: [
    p('M3 6h18'),
    p('M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'),
    p('M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'),
    p('M10 11v6'),
    p('M14 11v6'),
  ],
  extract: [
    p('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'),
    p('M14 2v6h6'),
    p('M16 13H8'),
    p('M16 17H8'),
    p('M10 9H8'),
  ],
  globe: [
    c(12, 12, 10),
    p('M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20'),
    p('M2 12h20'),
  ],
  menu: [p('M4 6h16'), p('M4 12h16'), p('M4 18h16')],
  close: [p('M18 6 6 18'), p('m6 6 12 12')],
  mail: [rect(2, 4, 20, 16, 2), p('m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7')],
  refresh: [
    p('M3 12a9 9 0 0 1 15-6.7L21 8'),
    p('M21 3v5h-5'),
    p('M21 12a9 9 0 0 1-15 6.7L3 16'),
    p('M3 21v-5h5'),
  ],
  user: [
    c(12, 12, 10),
    c(12, 10, 3),
    p('M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662'),
  ],
};

function renderShape(shape: IconShape): JSX.Element {
  if (shape.kind === 'circle') {
    return (
      <circle
        cx={shape.cx}
        cy={shape.cy}
        r={shape.r}
        fill={shape.filled ? 'currentColor' : 'none'}
        stroke={shape.filled ? 'none' : undefined}
      />
    );
  }
  if (shape.kind === 'rect') {
    return (
      <rect
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        rx={shape.rx}
      />
    );
  }
  return <path d={shape.d} />;
}

export function Icon(props: IconProps): JSX.Element {
  const size = () => props.size ?? 20;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size()}
      height={size()}
      fill="none"
      stroke="currentColor"
      stroke-width={props.strokeWidth ?? 1.75}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={['inline-block shrink-0', props.class]}
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : 'true'}
    >
      <For each={SHAPES[props.name]}>{(shape) => renderShape(shape)}</For>
    </svg>
  );
}
