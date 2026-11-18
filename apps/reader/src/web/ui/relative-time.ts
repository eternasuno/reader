const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const relativeDays = 30;

/**
 * The relative date of a list row (`reader-spec` Shared messages): under a
 * minute `刚刚`, then `N分前`, `N小时前`, `N天前` up to 30 days, after that the
 * `zh-CN` date. `now` is injectable so tests do not depend on the clock.
 */
export const relativeTime = (iso: string, now: number = Date.now()): string => {
  const elapsed = now - new Date(iso).getTime();

  if (!Number.isFinite(elapsed) || elapsed < minute) return '刚刚';
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}分前`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}小时前`;

  const days = Math.floor(elapsed / day);

  if (days <= relativeDays) return `${days}天前`;

  return new Date(iso).toLocaleDateString('zh-CN');
};
