import { createSignal, flush } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { SiteIcon } from '../src/components/SiteIcon';
import { mount, setupInteractions } from './support/list-helpers';

setupInteractions();

describe('SiteIcon fallback progression', () => {
  it('advances through candidates on error and falls back to svg', () => {
    const container = mount(() => (
      <SiteIcon
        srcs={['https://a.example/icon.png', 'https://a.example/favicon.ico']}
        fallback="rss"
        size={16}
      />
    ));

    const firstImg = container.querySelector('img');
    expect(firstImg?.getAttribute('src')).toBe('https://a.example/icon.png');

    firstImg?.dispatchEvent(new Event('error'));
    flush();

    const secondImg = container.querySelector('img');
    expect(secondImg?.getAttribute('src')).toBe(
      'https://a.example/favicon.ico'
    );

    secondImg?.dispatchEvent(new Event('error'));
    flush();

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});

describe('SiteIcon reset and empty state', () => {
  it('resets to the first candidate when srcs changes', () => {
    const [srcs, setSrcs] = createSignal<ReadonlyArray<string>>([
      'https://a.example/icon.png',
    ]);
    const container = mount(() => (
      <SiteIcon srcs={srcs()} fallback="rss" size={16} />
    ));

    container.querySelector('img')?.dispatchEvent(new Event('error'));
    flush();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();

    setSrcs(['https://b.example/icon.png', 'https://b.example/favicon.ico']);
    flush();

    const resetImg = container.querySelector('img');
    expect(resetImg?.getAttribute('src')).toBe('https://b.example/icon.png');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('renders fallback icon when srcs is empty', () => {
    const container = mount(() => (
      <SiteIcon srcs={[]} fallback="globe" size={16} />
    ));

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
