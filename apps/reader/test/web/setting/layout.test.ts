import { describe, expect, it } from 'vitest';
import { layoutOf, sectionShown } from '../../../src/web/setting/layout';
import { configurationLine } from '../../../src/web/setting/messages';

/**
 * The layout choice of `/settings` and the configuration line: the navigation
 * stands beside the sections only when the measurement says it fits (ui.md), and
 * the line reports whether each secret is stored, never its value (SET-VAL-4).
 */

describe('the layout of the page', () => {
  it('stands beside the sections when the navigation ends before them', () => {
    expect(
      layoutOf(
        { width: 160, left: 0, right: 160 },
        { width: 400, left: 184, right: 584 }
      )
    ).toBe('beside');
  });

  it('stacks when the sections wrapped below the navigation', () => {
    expect(
      layoutOf(
        { width: 160, left: 0, right: 160 },
        { width: 320, left: 0, right: 320 }
      )
    ).toBe('stacked');
  });

  it('stacks while an area is still unmeasured', () => {
    expect(
      layoutOf({ width: 0, left: 0, right: 0 }, { width: 0, left: 0, right: 0 })
    ).toBe('stacked');
  });
});

describe('which sections a layout shows', () => {
  it('beside the sections shows only the open one', () => {
    expect(sectionShown('beside', 'articles', 'account')).toBe(false);
    expect(sectionShown('beside', 'articles', 'articles')).toBe(true);
    expect(sectionShown('beside', 'articles', 'extraction')).toBe(false);
  });

  it('stacked shows all three, the open one included', () => {
    expect(sectionShown('stacked', 'articles', 'account')).toBe(true);
    expect(sectionShown('stacked', 'articles', 'articles')).toBe(true);
    expect(sectionShown('stacked', 'articles', 'extraction')).toBe(true);
  });
});

describe('the configuration line', () => {
  it('Scenario: A user who never saved settings', () => {
    expect(
      configurationLine({
        jinaKeyConfigured: false,
        browserEndpointConfigured: false,
      })
    ).toBe('Jina Key：未保存 · 浏览器服务地址：未保存');
  });

  it('Scenario: A configured key and address are reported, never shown', () => {
    expect(
      configurationLine({
        jinaKeyConfigured: true,
        browserEndpointConfigured: true,
      })
    ).toBe('Jina Key：已保存 · 浏览器服务地址：已保存');
  });

  it('reports each half on its own', () => {
    expect(
      configurationLine({
        jinaKeyConfigured: true,
        browserEndpointConfigured: false,
      })
    ).toBe('Jina Key：已保存 · 浏览器服务地址：未保存');
    expect(
      configurationLine({
        jinaKeyConfigured: false,
        browserEndpointConfigured: true,
      })
    ).toBe('Jina Key：未保存 · 浏览器服务地址：已保存');
  });
});
