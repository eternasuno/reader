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
  | 'user'
  | 'typography'
  | 'sidebar'
  | 'keyboard'
  | 'filter'
  | 'edit'
  | 'logout'
  | 'sort'
  | 'article'
  | 'checkbox'
  | 'checkbox-checked'
  | 'minus-circle'
  | 'plus-circle'
  | 'compass'
  | 'check-double'
  | 'fullscreen'
  | 'book'
  | 'speech'
  | 'image'
  | 'check-up';

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
  dots: [c(12, 5, 1), c(12, 12, 1), c(12, 19, 1)],
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
  inbox: [p('M6 16c5 0 7-8 12-8a4 4 0 0 1 0 8c-5 0-7-8-12-8a4 4 0 1 0 0 8')],
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
    p('M10 2v2'),
    p('M14 2v2'),
    p(
      'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1'
    ),
    p('M6 2v2'),
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
    p('M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8'),
    p('M21 3v5h-5'),
  ],
  user: [
    c(12, 12, 10),
    c(12, 10, 3),
    p('M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662'),
  ],
  typography: [
    p('m15 16 2.536-7.328a1.02 1.02 1 0 1 1.928 0L22 16'),
    p('M15.697 14h5.606'),
    p('m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16'),
    p('M3.304 13h6.392'),
  ],
  sidebar: [rect(3, 3, 18, 18, 2), p('M9 3v18'), p('m16 15-3-3 3-3')],
  keyboard: [
    rect(2, 4, 20, 16, 2),
    p('M6 8h.01'),
    p('M10 8h.01'),
    p('M14 8h.01'),
    p('M18 8h.01'),
    p('M8 12h.01'),
    p('M12 12h.01'),
    p('M16 12h.01'),
    p('M7 16h10'),
  ],
  filter: [p('M3 6h18'), p('M7 12h10'), p('M10 18h4')],
  edit: [p('M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z'), p('m15 5 4 4')],
  logout: [
    p('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'),
    p('m16 17 5-5-5-5'),
    p('M21 12H9'),
  ],
  sort: [
    p('M12 6v6l2 1'),
    p('M12.337 21.994a10 10 0 1 1 9.588-8.767'),
    p('m14 18 4 4 4-4'),
    p('M18 14v8'),
  ],
  article: [rect(4, 3, 16, 18, 2), p('M8 8h8'), p('M8 12h8'), p('M8 16h5')],
  checkbox: [rect(3, 3, 18, 18, 2)],
  'checkbox-checked': [
    p('M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344'),
    p('m9 11 3 3L22 4'),
  ],
  'minus-circle': [c(12, 12, 10), p('M8 12h8')],
  'plus-circle': [c(12, 12, 10), p('M8 12h8'), p('M12 8v8')],
  compass: [
    p(
      'm16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z'
    ),
    c(12, 12, 10),
  ],
  'check-double': [p('M18 6 7 17l-5-5'), p('m22 10-7.5 7.5L13 16')],
  fullscreen: [
    p('m15 15 6 6'),
    p('m15 9 6-6'),
    p('M21 16v5h-5'),
    p('M21 8V3h-5'),
    p('M3 16v5h5'),
    p('m3 21 6-6'),
    p('M3 8V3h5'),
    p('M9 9 3 3'),
  ],
  book: [
    p(
      'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20'
    ),
  ],
  speech: [
    p(
      'M8.8 20v-4.1l1.9.2a2.3 2.3 0 0 0 2.164-2.1V8.3A5.37 5.37 0 0 0 2 8.25c0 2.8.656 3.054 1 4.55a5.77 5.77 0 0 1 .029 2.758L2 20'
    ),
    p('M19.8 17.8a7.5 7.5 0 0 0 .003-10.603'),
    p('M17 15a3.5 3.5 0 0 0-.025-4.975'),
  ],
  image: [
    rect(3, 3, 18, 18, 2),
    c(9, 9, 2),
    p('m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21'),
  ],
  'check-up': [p('M 18 6 L 7 17 l -5 -5 M 18 18 V 11 M 15 14 L 18 11 L 21 14')],
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
