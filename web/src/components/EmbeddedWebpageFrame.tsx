import type { JSX } from '@solidjs/web';
import { createMemo, Show } from 'solid-js';
import { t } from '../i18n';

export interface EmbeddedWebpageFrameProps {
  url: string;
  title?: string;
}

export const isSafeEmbedUrl = (rawUrl: string, appOrigin?: string): boolean => {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) return false;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (parsed.username !== '' || parsed.password !== '') return false;

  const origin = appOrigin ?? window.location.origin;
  if (!origin) return false;

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }

  if (normalizedOrigin === 'null') return false;

  return parsed.origin !== normalizedOrigin;
};

/**
 * `RD-WEBPAGE-1`: the embedded external-page view. Deliberately a separate
 * component from `ArticleFrame` and never merged with it.
 */
export function EmbeddedWebpageFrame(
  props: EmbeddedWebpageFrameProps
): JSX.Element {
  const safe = createMemo(() => isSafeEmbedUrl(props.url));

  return (
    <div class="flex h-full min-h-0 w-full flex-1 flex-col">
      <Show
        when={safe()}
        fallback={
          <p
            role="alert"
            class="m-4 rounded-box border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
          >
            {String(t('reader.embeddedUnsafeUrl'))}
          </p>
        }
      >
        <iframe
          src={props.url}
          title={props.title ?? String(t('reader.embeddedWebpageView'))}
          sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
          referrerpolicy="no-referrer"
          class="h-full w-full flex-1 border-0 bg-base-100"
        />
      </Show>
    </div>
  );
}
