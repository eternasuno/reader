import type { JSX } from '@solidjs/web';
import { createMemo, Show } from 'solid-js';
import { t } from '../i18n';

export interface EmbeddedWebpageFrameProps {
  url: string;
  title?: string;
}

const defaultAppOrigin = (): string | undefined => {
  if (typeof window === 'undefined') return undefined;

  return window.location?.origin;
};

/**
 * `RD-WEBPAGE-1`: only absolute `http`/`https` URLs without credentials that
 * are not same-origin with the app may be embedded. The iframe keeps
 * `allow-same-origin`, so a same-origin URL would expose the app origin.
 */
export const isSafeEmbedUrl = (rawUrl: string, appOrigin?: string): boolean => {
  if (typeof rawUrl !== 'string') return false;

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

  const origin = appOrigin ?? defaultAppOrigin();
  if (!origin) return true;

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return true;
  }

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
    <div class="flex min-h-0 flex-1 flex-col gap-2">
      <Show
        when={safe()}
        fallback={
          <p
            role="alert"
            class="rounded-box border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
          >
            {String(t('reader.embeddedUnsafeUrl'))}
          </p>
        }
      >
        <p class="rounded-box border border-base-300 bg-base-200 px-3 py-2 text-sm text-base-content/70">
          {String(t('reader.embeddedNotice'))}
        </p>
        <iframe
          src={props.url}
          title={props.title ?? String(t('reader.embeddedWebpageView'))}
          sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
          referrerpolicy="no-referrer"
          class="w-full flex-1 min-h-[70dvh] border-0 rounded-box bg-base-200"
        />
      </Show>
    </div>
  );
}
