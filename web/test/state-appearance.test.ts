import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FONT_FAMILIES } from '../src/components/articleTypography';

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

describe('FONT_FAMILIES reader stacks', () => {
  it('maps every font choice to a distinct stack with a generic fallback', () => {
    expect(Object.keys(FONT_FAMILIES).sort()).toEqual(['sans', 'serif']);
    expect(FONT_FAMILIES.sans).not.toBe(FONT_FAMILIES.serif);
    expect(FONT_FAMILIES.sans.endsWith(', sans-serif')).toBe(true);
    expect(FONT_FAMILIES.serif.startsWith('Georgia, "Times New Roman"')).toBe(
      true
    );
    expect(FONT_FAMILIES.serif.endsWith(', serif')).toBe(true);
  });

  it('lists Latin fonts before CJK fonts in both stacks', () => {
    const precedes = (stack: string, latin: string, cjk: string) =>
      stack.indexOf(latin) !== -1 && stack.indexOf(latin) < stack.indexOf(cjk);

    expect(precedes(FONT_FAMILIES.sans, 'Arial', 'PingFang SC')).toBe(true);
    expect(precedes(FONT_FAMILIES.serif, 'Georgia', 'Songti SC')).toBe(true);
  });
});
