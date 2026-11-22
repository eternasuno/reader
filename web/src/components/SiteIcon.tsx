import type { JSX } from '@solidjs/web';
import { createSignal, Show } from 'solid-js';
import { siteIconUrl } from '../state';
import { Icon, type IconName } from '../ui';

/**
 * `LIB-ROW-1`: site favicon for a feed, row, or reader source line. Falls back to
 * `fallback` when the URL is unusable or the image fails; keyed so a reused row
 * retries with a new site instead of keeping the previous failure.
 */
export function SiteIcon(props: {
  url: string;
  fallback: IconName;
  size: number;
}): JSX.Element {
  return (
    <Show
      when={siteIconUrl(props.url)}
      keyed
      fallback={<FallbackIcon name={props.fallback} size={props.size} />}
    >
      {(src) => (
        <SiteIconImage src={src} fallback={props.fallback} size={props.size} />
      )}
    </Show>
  );
}

function SiteIconImage(props: {
  src: string;
  fallback: IconName;
  size: number;
}): JSX.Element {
  const [failed, setFailed] = createSignal(false);

  return (
    <Show
      when={!failed()}
      fallback={<FallbackIcon name={props.fallback} size={props.size} />}
    >
      <img
        src={props.src}
        alt=""
        width={props.size}
        height={props.size}
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        class="shrink-0 rounded-sm object-contain"
        style={{ width: `${props.size}px`, height: `${props.size}px` }}
        onError={() => setFailed(true)}
      />
    </Show>
  );
}

function FallbackIcon(props: { name: IconName; size: number }): JSX.Element {
  return <Icon name={props.name} size={props.size} class="opacity-60" />;
}
