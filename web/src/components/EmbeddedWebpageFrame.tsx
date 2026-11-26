import type { JSX } from '@solidjs/web';
import { createMemo, Show } from 'solid-js';
import { t } from '../i18n';

export interface EmbeddedWebpageFrameProps {
  url: string;
  title?: string;
}

type EmbedNoticeKey = 'reader.embeddedInvalidUrl' | 'reader.embeddedUnsafeUrl';

const embedNoticeFor = (url: string): EmbedNoticeKey | undefined => {
  if (!URL.canParse(url)) return 'reader.embeddedInvalidUrl';

  const parsed = new URL(url);
  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.origin === window.location.origin
  ) {
    return 'reader.embeddedUnsafeUrl';
  }

  return undefined;
};

/**
 * `RD-WEBPAGE-1`: the embedded external-page view. Deliberately a separate
 * component from `ArticleBody` and never merged with it.
 */
export function EmbeddedWebpageFrame(
  props: EmbeddedWebpageFrameProps
): JSX.Element {
  const notice = createMemo(() => embedNoticeFor(props.url));

  return (
    <div class="flex h-full min-h-0 w-full flex-1 flex-col">
      <Show
        when={notice()}
        fallback={
          <iframe
            src={props.url}
            title={props.title ?? t('reader.embeddedWebpageView')}
            sandbox="allow-scripts allow-forms allow-popups allow-same-origin"
            referrerpolicy="no-referrer"
            class="h-full w-full flex-1 border-0 bg-base-100"
          />
        }
      >
        {(key) => (
          <p
            role="alert"
            class="m-4 rounded-box border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
          >
            {t(key())}
          </p>
        )}
      </Show>
    </div>
  );
}
