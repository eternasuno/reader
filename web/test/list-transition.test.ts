import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerListTransitionTarget,
  runListTransition,
} from '../src/ui/listTransition';

type Update = () => Promise<void>;

const visibleList = (): HTMLElement => {
  const element = document.createElement('div');
  element.getBoundingClientRect = () =>
    ({
      top: 50,
      left: 10,
      right: 310,
      bottom: 450,
      width: 300,
      height: 400,
    }) as DOMRect;
  document.body.append(element);
  return element;
};

/** A transition that runs its update immediately and finishes right after it. */
const installViewTransition = () => {
  const start = vi.fn((update: Update) => {
    const done = Promise.resolve().then(update);
    return {
      updateCallbackDone: done,
      ready: done,
      finished: done,
      skipTransition: () => undefined,
    };
  });
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: start,
  });
  return start;
};

let unregister: (() => void) | undefined;

afterEach(() => {
  unregister?.();
  unregister = undefined;
  Reflect.deleteProperty(document, 'startViewTransition');
  document.body.replaceChildren();
});

describe('runListTransition', () => {
  it('applies the update immediately without a registered list', async () => {
    const start = installViewTransition();
    const update = vi.fn();

    await runListTransition(update);

    expect(update).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  });

  it('applies the update immediately where view transitions are unsupported', async () => {
    unregister = registerListTransitionTarget(visibleList());
    const update = vi.fn();

    await runListTransition(update);

    expect(update).toHaveBeenCalledOnce();
  });

  it('runs the update inside a transition clipped to the list, naming its rows only meanwhile', async () => {
    const start = installViewTransition();
    const list = visibleList();
    unregister = registerListTransitionTarget(list);
    const root = document.documentElement;
    let duringUpdate: { active: boolean; clip: string } | undefined;

    await runListTransition(() => {
      duringUpdate = {
        active: list.hasAttribute('data-list-transition'),
        clip: root.style.getPropertyValue('--list-transition-clip'),
      };
    });

    expect(start).toHaveBeenCalledOnce();
    expect(duringUpdate?.active).toBe(true);
    expect(duringUpdate?.clip).toBe(
      `inset(50px ${root.clientWidth - 310}px ${root.clientHeight - 450}px 10px)`
    );
    await vi.waitFor(() =>
      expect(list.hasAttribute('data-list-transition')).toBe(false)
    );
    expect(root.style.getPropertyValue('--list-transition-clip')).toBe('');
  });

  it('skips the transition while the list is scrolling', async () => {
    const start = installViewTransition();
    const list = visibleList();
    unregister = registerListTransitionTarget(list);
    const update = vi.fn();

    list.dispatchEvent(new Event('scroll'));
    await runListTransition(update);

    expect(update).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
  });
});
