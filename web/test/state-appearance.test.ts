import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FONT_FAMILIES } from '../src/components/articleTypography';

type StateModule = typeof import('../src/state');
type ReaderAppearance = import('../src/state').ReaderAppearance;

let state: StateModule;

beforeEach(async () => {
  localStorage.clear();
  vi.resetModules();
  state = await import('../src/state');
});

describe('readerAppearance state', () => {
  it('updates appearance, sets isDefaultAppearance false, and persists JSON', () => {
    const next = {
      fontSize: 'lg' as const,
      fontFamily: 'serif' as const,
      lineWidth: 'medium' as const,
      lineHeight: 'relaxed' as const,
    };

    state.updateReaderAppearance(next);

    expect(state.readerAppearance()).toEqual(next);
    expect(state.isDefaultAppearance()).toBe(false);
    expect(
      JSON.parse(localStorage.getItem(state.APPEARANCE_STORAGE_KEY) ?? 'null')
    ).toEqual(next);
  });

  it('restores DEFAULT_APPEARANCE on resetReaderAppearance', () => {
    state.updateReaderAppearance({ fontSize: 'xl', fontFamily: 'serif' });
    expect(state.isDefaultAppearance()).toBe(false);

    state.resetReaderAppearance();

    expect(state.readerAppearance()).toEqual(state.DEFAULT_APPEARANCE);
    expect(state.isDefaultAppearance()).toBe(true);
    expect(localStorage.getItem(state.APPEARANCE_STORAGE_KEY)).toBeNull();
  });
});

describe('readerAppearance tiers', () => {
  it('keeps the previous tier when a stored or patched value is unknown', async () => {
    state.updateReaderAppearance({ fontSize: 'xl' });
    state.updateReaderAppearance({
      fontSize: 18,
      lineHeight: 2,
    } as unknown as Partial<ReaderAppearance>);
    expect(state.readerAppearance()).toEqual({
      ...state.DEFAULT_APPEARANCE,
      fontSize: 'xl',
    });

    localStorage.setItem(
      state.APPEARANCE_STORAGE_KEY,
      JSON.stringify({
        fontSize: 22,
        fontFamily: 'serif',
        lineWidth: 'narrow',
        lineHeight: 'loose',
      })
    );
    vi.resetModules();
    const reloaded = await import('../src/state');
    expect(reloaded.readerAppearance()).toEqual({
      ...reloaded.DEFAULT_APPEARANCE,
      fontFamily: 'serif',
      lineWidth: 'narrow',
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
        isolated.updateReaderAppearance({ fontSize: 'xl' })
      ).not.toThrow();
      expect(isolated.readerAppearance().fontSize).toBe('xl');
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
