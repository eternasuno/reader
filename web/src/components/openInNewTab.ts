/** Opens a source URL in a new tab without leaking the referrer or opener. */
export const openInNewTab = (url: string): void => {
  window.open(url, '_blank', 'noopener,noreferrer');
};
