import type { JSX } from '@solidjs/web';
import { createEffect, createSignal, Show } from 'solid-js';
import { buildLibraryUrl, type LibraryScope, openArticle } from '../state';
import { ReaderEmptyState } from './ReaderEmptyState';
import { ReaderView } from './ReaderView';
import { deleteOpenArticle, saveOpenArticle } from './readerActions';
import type { ReaderNav } from './readerNav';

export interface ReaderPaneProps {
  scope: LibraryScope;
  unreadOnly: boolean;
  onNavigate: (url: string) => void;
}

/**
 * `reader.md`: header actions (`RD-READ-1`, `RD-EXTRACT-1`, `RD-NAV-1`),
 * metadata (`RD-CONTENT-1`), and the extracted / default / embedded body
 * (`RD-WEBPAGE-1`).
 */
export function ReaderPane(props: ReaderPaneProps): JSX.Element {
  const [savingToLater, setSavingToLater] = createSignal(false);
  const nav: ReaderNav = {
    listUrl: () =>
      buildLibraryUrl(props.scope, { unreadOnly: props.unreadOnly }),
    laterUrl: () =>
      buildLibraryUrl({ kind: 'later' }, { unreadOnly: props.unreadOnly }),
    articleUrl: (articleId) =>
      buildLibraryUrl(props.scope, { articleId, unreadOnly: props.unreadOnly }),
    onNavigate: (url) => props.onNavigate(url),
  };

  // `RD-ARTICLE-1`: switching articles resets the in-flight save affordance.
  createEffect(
    () => openArticle()?.id ?? null,
    () => {
      setSavingToLater(false);
    }
  );

  return (
    <main class="flex h-full min-h-0 flex-col bg-base-100">
      <Show when={openArticle()} fallback={<ReaderEmptyState />}>
        {(current) => (
          <ReaderView
            article={current()}
            nav={nav}
            savingToLater={savingToLater()}
            onSaveToLater={() =>
              void saveOpenArticle(current(), savingToLater, setSavingToLater)
            }
            onDelete={() => void deleteOpenArticle(nav, current())}
          />
        )}
      </Show>
    </main>
  );
}
