import { createSignal } from 'solid-js';
import { onSessionCleared } from './session';

const minuteMs = 60_000;

const [now, setNow] = createSignal<number>(Date.now(), { name: 'clock.now' });

export { now };

const activeMounts = new Set<symbol>();

let timer: ReturnType<typeof setTimeout> | undefined;

const clearTimer = (): void => {
  clearTimeout(timer);
  timer = undefined;
};

const refreshClock = (): void => {
  clearTimer();
  if (document.hidden) return;

  const currentTime = Date.now();
  const nextMinute = (Math.floor(currentTime / minuteMs) + 1) * minuteMs;
  setNow(currentTime);
  timer = setTimeout(refreshClock, nextMinute - currentTime);
};

const stopClock = (): void => {
  clearTimer();
  document.removeEventListener('visibilitychange', refreshClock);
};

export const mountClock = (): (() => void) => {
  const token = Symbol('clock');
  activeMounts.add(token);

  if (activeMounts.size === 1) {
    document.addEventListener('visibilitychange', refreshClock);
    refreshClock();
  }

  return () => {
    if (!activeMounts.delete(token)) return;
    if (activeMounts.size === 0) stopClock();
  };
};

onSessionCleared(() => {
  if (activeMounts.size === 0) return;
  activeMounts.clear();
  stopClock();
});
