# Known Upstream Issues

Bugs found in pinned dependencies that shape project code. Each entry records the workaround, how to re-check, and its reporting status. Remove an entry once a released fix is verified and the workaround is gone.

## Solid: overlapping actions on one optimistic key freeze DOM bindings

- **Affects**: `solid-js` / `@solidjs/signals` 2.0.3 and 2.0.4 (verified 2026-11-25).
- **Symptom**: two `action`s that write the same key of a `createOptimisticStore` and overlap in time (for example, a user toggling an article's read state twice before the first request returns). After both settle, the store reads the right value, but a `createMemo` and the DOM binding over that key show a stale value. Later writes to the base store still do not reach the DOM.
- **Related** (2.0.3 and 2.0.4): when two actions on different keys overlap and one fails, its optimistic write reverts only after the other action settles, because the transitions merge.
- **Workaround**: do not use `action` / `createOptimistic` / `createOptimisticStore` for user mutations. Write the entity store directly, serialize server requests per entity, and on failure restore the last server-confirmed value.
- **Status**: not reported upstream yet. Report it separately with the minimal reproduction below, using no project details.
- **Re-check**: after upgrading Solid, run the reproduction under Vitest (jsdom). The bug is fixed when every log line shows `dom` matching `view`.

```tsx
import { render } from '@solidjs/web';
import { action, createMemo, createOptimisticStore, createStore, flush } from 'solid-js';
import { it } from 'vitest';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};
const settle = async () => { await new Promise((r) => setTimeout(r, 100)); flush(); };

it('overlapping optimistic actions on one key', async () => {
  const [base, setBase] = createStore({ read: false });
  const [view, setView] = createOptimisticStore(base);
  const host = document.createElement('div');
  render(() => <p data-read={view.read ? 'y' : 'n'} />, host);
  const memo = createMemo(() => view.read);
  flush();

  const toggle = action(function* (read: boolean, d: Promise<void>) {
    setView((s) => { s.read = read; });
    yield d;
    setBase((s) => { s.read = read; });
  });

  const d1 = deferred();
  const d2 = deferred();
  const p1 = toggle(true, d1.promise); flush();
  const p2 = toggle(false, d2.promise); flush();
  d2.resolve(); await p2; await settle();
  d1.resolve(); await p1; await settle();
  // Observed: view true, base true, memo false, dom 'n'.
  console.log('view', view.read, 'base', base.read, 'memo', memo(), 'dom', host.querySelector('p')!.dataset.read);

  setBase((s) => { s.read = !s.read; }); flush(); await settle();
  // Observed: view changes, dom stays 'n'.
  console.log('after extra write: view', view.read, 'dom', host.querySelector('p')!.dataset.read);
});
```
