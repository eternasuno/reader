import { Show } from 'solid-js';

export const ReaderTitle = (props: { title: string; url: string }) => (
  <h2 class="min-w-0 text-balance break-words text-lg font-semibold leading-snug text-base-content sm:text-xl">
    <Show when={props.url} fallback={props.title}>
      <a href={props.url} target="_blank" rel="noopener noreferrer">
        {props.title}
      </a>
    </Show>
  </h2>
);

const sourceHostname = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

export const ReaderSourceLink = (props: { url: string }) => (
  <Show when={props.url}>
    <p class="truncate text-xs text-base-content/60" title={props.url}>
      <a href={props.url} target="_blank" rel="noopener noreferrer">
        {sourceHostname(props.url)}
      </a>
    </p>
  </Show>
);
