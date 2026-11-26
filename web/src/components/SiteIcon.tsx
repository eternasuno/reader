import type { JSX } from '@solidjs/web';
import { createSignal, Show } from 'solid-js';
import { Icon, type IconName } from '../ui';

/**
 * `LIB-ROW-1`: ordered candidate icon URLs (`srcs`) for a feed, row, or reader source line.
 * Advances through candidates on image error and falls back to `fallback` when none remain;
 * keyed by candidate list so a reused row resets to the first candidate.
 */
export function SiteIcon(props: {
  srcs: ReadonlyArray<string>;
  fallback: IconName;
  size: number;
}): JSX.Element {
  return (
    <Show
      when={props.srcs.join('\n')}
      keyed
      fallback={<FallbackIcon name={props.fallback} size={props.size} />}
    >
      {(_key) => (
        <SiteIconImage
          srcs={props.srcs}
          fallback={props.fallback}
          size={props.size}
        />
      )}
    </Show>
  );
}

function SiteIconImage(props: {
  srcs: ReadonlyArray<string>;
  fallback: IconName;
  size: number;
}): JSX.Element {
  const [index, setIndex] = createSignal(0);
  const current = () => props.srcs[index()];

  return (
    <Show
      when={current()}
      fallback={<FallbackIcon name={props.fallback} size={props.size} />}
    >
      {(src) => (
        <img
          src={src()}
          alt=""
          width={props.size}
          height={props.size}
          loading="lazy"
          decoding="async"
          referrerpolicy="no-referrer"
          class="shrink-0 rounded-sm object-contain"
          style={{ width: `${props.size}px`, height: `${props.size}px` }}
          onError={() => setIndex((i) => i + 1)}
        />
      )}
    </Show>
  );
}

function FallbackIcon(props: { name: IconName; size: number }): JSX.Element {
  return <Icon name={props.name} size={props.size} class="opacity-60" />;
}
