import { Option } from 'effect';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { useReaderMode } from '../../src/pages/library-reader-mode';
import { article, deferred } from './library-fixtures';

const setup = () =>
  createRoot((dispose) => {
    const [current, setCurrent] = createSignal<ReturnType<typeof article>>(
      article('a', { url: 'https://example.com/a' })
    );
    const extraction = deferred<ReturnType<typeof article> | undefined>();
    const view = useReaderMode(current, async () => {
      const updated = await extraction.promise;
      if (updated !== undefined) setCurrent(updated);

      return updated;
    });

    return { dispose, current, setCurrent, extraction, view };
  });

describe('reader extraction mode', () => {
  it('shows extracted content after the first extraction updates the same article', async () => {
    const state = setup();
    try {
      const pending = state.view.pick('extracted');
      expect(state.view.extracting()).toBe(true);
      state.extraction.resolve({
        ...state.current(),
        extractedContent: Option.some('<p>Extracted</p>'),
      });
      await pending;
      expect(state.view.extracting()).toBe(false);
      expect(state.view.mode()).toBe('extracted');
      await state.view.pick('original');
      expect(state.view.mode()).toBe('original');
    } finally {
      state.dispose();
    }
  });

  it('resets the mode when a different article is selected', async () => {
    const state = setup();
    try {
      state.setCurrent({
        ...state.current(),
        extractedContent: Option.some('<p>Extracted</p>'),
      });
      await state.view.pick('extracted');
      state.setCurrent(article('b', { url: 'https://example.com/b' }));
      expect(state.view.mode()).toBe('original');
    } finally {
      state.dispose();
    }
  });
});
