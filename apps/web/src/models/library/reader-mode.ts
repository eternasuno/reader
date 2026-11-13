import { Option } from 'effect';
import { createEffect, createMemo, createSignal, on } from 'solid-js';
import type { Article } from '../../api/library';

export type LibraryReaderMode = 'original' | 'extracted' | 'webpage';

const hasText = (value: Option.Option<string>): boolean =>
  Option.match(value, {
    onNone: () => false,
    onSome: (text) => text !== '',
  });

export const useReaderMode = (
  article: () => Article,
  onExtract: (article: Article) => Promise<Article | undefined>
) => {
  const [mode, setMode] = createSignal<LibraryReaderMode>('original');
  const [extracting, setExtracting] = createSignal(false);
  const articleId = createMemo(() => article().id);
  let run = 0;
  createEffect(
    on(articleId, () => {
      run += 1;
      setMode('original');
      setExtracting(false);
    })
  );
  const hasUrl = () => hasText(article().url);
  const hasExtracted = () => hasText(article().extractedContent);
  const pick = async (next: LibraryReaderMode) => {
    if (next === mode() || !hasUrl()) return;

    if (next !== 'extracted' || hasExtracted()) {
      setMode(next);

      return;
    }

    const token = ++run;
    setExtracting(true);
    const updated = await onExtract(article());
    if (token !== run) return;

    setExtracting(false);
    if (updated !== undefined) setMode('extracted');
  };

  return { mode, extracting, hasUrl, hasExtracted, pick };
};
