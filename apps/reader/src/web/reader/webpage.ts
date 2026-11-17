/**
 * The address the embedded view may load (RD-WEBPAGE-4): a page without a user
 * name or password that does not point at the app itself. Every article has an
 * `http` or `https` URL (CM-URL-1), so the address decides, not its absence.
 */
export const embeddableUrl = (
  url: string,
  appOrigin: string
): string | undefined => {
  const parsed = new URL(url);

  return parsed.username === '' &&
    parsed.password === '' &&
    parsed.origin !== appOrigin
    ? parsed.href
    : undefined;
};
