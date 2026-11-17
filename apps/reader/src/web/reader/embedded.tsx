import { Show } from 'solid-js';
import { readerMessages as copy } from './messages';
import { embeddableUrl } from './webpage';

/**
 * The embedded original page (RD-WEBPAGE-2, RD-WEBPAGE-3): a notice bar whose
 * `打开原文` link opens the page in a new tab, and the page itself in a frame
 * that keeps same-origin access because it is a foreign page, not article HTML.
 * The header above stays visible, so the view can always be left. An address that
 * cannot be embedded safely gets the notice instead of a frame (RD-WEBPAGE-4).
 */
export const EmbeddedPage = (props: { readonly url: string }) => {
  const source = () => embeddableUrl(props.url, window.location.origin);

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <p class="shrink-0 border-b border-base-200 px-4 py-2 text-xs leading-relaxed text-base-content/60">
        {copy.embeddedNoticeLead}
        <a
          class="link mx-1"
          href={props.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {copy.openOriginal}
        </a>
        {copy.embeddedNoticeTail}
      </p>
      <Show
        when={source()}
        fallback={
          <p class="p-6 text-sm text-base-content/60">{copy.notEmbeddable}</p>
        }
      >
        {(href) => (
          <iframe
            title={copy.embeddedFrameTitle}
            class="block min-h-0 w-full flex-1 border-0 bg-white"
            src={href()}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
            referrerpolicy="no-referrer"
            allow="fullscreen"
          />
        )}
      </Show>
    </div>
  );
};
