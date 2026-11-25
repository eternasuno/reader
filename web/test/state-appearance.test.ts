import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isValidImageMessage,
  isValidKeyMessage,
} from '../src/components/ArticleFrame';
import { buildReaderStyles } from '../src/components/articleFrameStyles';

type StateModule = typeof import('../src/state');

let state: StateModule;

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  state = await import('../src/state');
});

describe('readerAppearance state', () => {
  it('updates appearance, sets isDefaultAppearance false, and persists JSON', () => {
    const next = {
      fontSize: 18 as const,
      fontFamily: 'serif' as const,
      lineWidth: 5 as const,
      lineHeight: 2.0 as const,
    };

    state.updateReaderAppearance(next);

    expect(state.readerAppearance()).toEqual(next);
    expect(state.isDefaultAppearance()).toBe(false);
    expect(
      JSON.parse(localStorage.getItem(state.APPEARANCE_STORAGE_KEY) ?? 'null')
    ).toEqual(next);
  });

  it('restores DEFAULT_APPEARANCE on resetReaderAppearance', () => {
    state.updateReaderAppearance({ fontSize: 20, fontFamily: 'serif' });
    expect(state.isDefaultAppearance()).toBe(false);

    state.resetReaderAppearance();

    expect(state.readerAppearance()).toEqual(state.DEFAULT_APPEARANCE);
    expect(state.isDefaultAppearance()).toBe(true);
    expect(localStorage.getItem(state.APPEARANCE_STORAGE_KEY)).toBeNull();
  });
});

describe('readerAppearance steppers', () => {
  it('steps fontSize, lineHeight, and lineWidth within bounds', () => {
    state.stepFontSize(1);
    expect(state.readerAppearance().fontSize).toBe(18);
    state.stepFontSize(1);
    state.stepFontSize(1);
    state.stepFontSize(1);
    expect(state.readerAppearance().fontSize).toBe(22);
    state.stepFontSize(-1);
    expect(state.readerAppearance().fontSize).toBe(20);

    state.stepLineHeight(1);
    state.stepLineHeight(1);
    expect(state.readerAppearance().lineHeight).toBe(2.0);
    state.stepLineHeight(-1);
    state.stepLineHeight(-1);
    state.stepLineHeight(-1);
    state.stepLineHeight(-1);
    expect(state.readerAppearance().lineHeight).toBe(1.4);

    state.stepLineWidth(1);
    expect(state.readerAppearance().lineWidth).toBe(6);
    state.stepLineWidth(-1);
    expect(state.readerAppearance().lineWidth).toBe(5);
  });
});

describe('readerAppearance legacy migration', () => {
  it('normalizes legacy string values on update and reload', async () => {
    state.updateReaderAppearance({
      fontSize: 'lg',
      lineHeight: 'relaxed',
      lineWidth: 'wide',
    });
    expect(state.readerAppearance()).toEqual({
      fontSize: 18,
      fontFamily: 'sans',
      lineWidth: 6,
      lineHeight: 2.0,
    });

    localStorage.setItem(
      state.APPEARANCE_STORAGE_KEY,
      JSON.stringify({
        fontSize: 'lg',
        fontFamily: 'serif',
        lineWidth: 'wide',
        lineHeight: 'relaxed',
      })
    );
    vi.resetModules();
    const reloaded = await import('../src/state');
    expect(reloaded.readerAppearance()).toEqual({
      fontSize: 18,
      fontFamily: 'serif',
      lineWidth: 6,
      lineHeight: 2.0,
    });
  });
});

describe('safe storage fallback', () => {
  it('survives when window.localStorage throws on access', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
    try {
      vi.resetModules();
      const isolated = await import('../src/state/appearance');
      expect(isolated.readerAppearance()).toEqual(isolated.DEFAULT_APPEARANCE);
      expect(isolated.readerTheme()).toBe('auto');
      expect(() =>
        isolated.updateReaderAppearance({ fontSize: 20 })
      ).not.toThrow();
      expect(isolated.readerAppearance().fontSize).toBe(20);
      expect(() => isolated.setReaderTheme('dark')).not.toThrow();
      expect(isolated.readerTheme()).toBe('dark');
      expect(() => isolated.resetReaderAppearance()).not.toThrow();
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    }
  });
});

describe('sidebarCollapsed state', () => {
  it('defaults to false and persists toggle and explicit updates', () => {
    expect(state.sidebarCollapsed()).toBe(false);

    state.toggleSidebarCollapse();
    expect(state.sidebarCollapsed()).toBe(true);
    expect(localStorage.getItem(state.SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      'true'
    );

    state.toggleSidebarCollapse();
    expect(state.sidebarCollapsed()).toBe(false);
    expect(localStorage.getItem(state.SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      'false'
    );

    state.setSidebarCollapsedState(true);
    expect(state.sidebarCollapsed()).toBe(true);
    expect(localStorage.getItem(state.SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe(
      'true'
    );
  });
});

describe('buildReaderStyles', () => {
  it('outputs serif font family, numeric font-size, and line-height', () => {
    const css = buildReaderStyles({
      fontSize: 18,
      fontFamily: 'serif',
      lineWidth: 6,
      lineHeight: 2.0,
    });

    expect(css).toContain('Georgia, "Times New Roman"');
    expect(css).toContain('serif');
    expect(css).toContain('font-size: 18px;');
    expect(css).toContain('line-height: 2;');

    const defaults = buildReaderStyles();
    expect(defaults).toContain('sans-serif');
    expect(defaults).toContain('font-size: 16px;');
    expect(defaults).toContain('line-height: 1.8;');
  });
});

const imgMsg = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  type: 'article-frame-image',
  token: 'tok',
  src: 'https://example.com/a.jpg',
  ...overrides,
});

const INVALID_IMAGE_CASES: ReadonlyArray<[unknown, string]> = [
  [imgMsg({ token: 'wrong' }), 'tok'],
  [imgMsg({ token: '' }), ''],
  [imgMsg({ type: 'article-frame-resize' }), 'tok'],
  [imgMsg({ src: 'javascript:alert(1)' }), 'tok'],
  [imgMsg({ src: 'data:image/png;base64,AA' }), 'tok'],
  [imgMsg({ src: '/relative.png' }), 'tok'],
  [imgMsg({ alt: 123 }), 'tok'],
  [null, 'tok'],
];

describe('isValidImageMessage', () => {
  it('accepts http(s) image messages with a matching token', () => {
    expect(isValidImageMessage(imgMsg(), 'tok')).toBe(true);
    expect(
      isValidImageMessage(
        imgMsg({ src: 'http://example.com/b.png', alt: 'photo' }),
        'tok'
      )
    ).toBe(true);
  });

  it('rejects mismatched tokens, wrong types, and unsafe image URLs', () => {
    for (const [data, token] of INVALID_IMAGE_CASES) {
      expect(isValidImageMessage(data, token)).toBe(false);
    }
  });
});

describe('isValidKeyMessage', () => {
  it('accepts Escape with a matching token', () => {
    {
      const key = 'Escape';
      expect(
        isValidKeyMessage(
          { type: 'article-frame-key', token: 'tok', key },
          'tok'
        )
      ).toBe(true);
    }
  });

  it('rejects mismatched tokens, wrong types, and other keys', () => {
    const cases: Array<[unknown, string]> = [
      [{ type: 'article-frame-key', token: 'wrong', key: 'Escape' }, 'tok'],
      [{ type: 'article-frame-key', token: '', key: 'Escape' }, ''],
      [{ type: 'article-frame-image', token: 'tok', key: 'Escape' }, 'tok'],
      [{ type: 'article-frame-key', token: 'tok', key: 'j' }, 'tok'],
      [{ type: 'article-frame-key', token: 'tok', key: 'Enter' }, 'tok'],
      [{ type: 'article-frame-key', token: 'tok', key: 'a' }, 'tok'],
      [{ type: 'article-frame-key', token: 'tok', key: 42 }, 'tok'],
      [null, 'tok'],
    ];

    for (const [data, token] of cases) {
      expect(isValidKeyMessage(data, token)).toBe(false);
    }
  });
});
