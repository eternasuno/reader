import { browserHref } from '../api/url';
import { t } from '../i18n';
import { showToast } from '../ui';

/**
 * Opens a source URL in a new tab without leaking the referrer or opener. URLs
 * the browser cannot parse (e.g. scoped IPv6 hosts the server accepts) show a
 * toast instead of opening a tab (`LIB-LINK-1`).
 */
export const openInNewTab = (url: string): void => {
  const href = browserHref(url);
  if (href === undefined) {
    showToast(t('reader.cannotOpenLinkToast'), 'error');
    return;
  }

  window.open(href, '_blank', 'noopener,noreferrer');
};
