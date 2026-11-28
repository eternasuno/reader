import type { JSX } from '@solidjs/web';
import { Show } from 'solid-js';
import { t } from '../i18n';
import { loadingArticle } from '../state';
import { Icon } from '../ui';
import { ReaderSkeleton } from './ReaderView';

/** Empty / loading halves of the reader pane when no article is open. */
export function ReaderEmptyState(): JSX.Element {
  return (
    <Show when={loadingArticle()} fallback={<NoArticleOpen />}>
      <ReaderSkeleton label={t('library.loading')} />
    </Show>
  );
}

function NoArticleOpen(): JSX.Element {
  return (
    <div class="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
      <Icon name="bookmark" size={40} class="opacity-30" />
      <p class="text-base font-medium">{t('reader.emptyTitle')}</p>
      <p class="text-sm text-base-content/60">{t('reader.emptyHint')}</p>
    </div>
  );
}
