import { HttpStaticServer } from 'effect/http';

/**
 * The built web assets, served from `public/` beside `server.js` in the
 * runtime directory (reader-engineering deployment.md). An unmatched
 * extensionless request that accepts HTML falls back to `index.html`, a path
 * with an extension answers 404, and every file response carries
 * `Cache-Control: no-cache` so a deploy is never answered from a stale cache.
 */
export const StaticRoutesLive = HttpStaticServer.layer({
  root: 'public',
  spa: true,
  cacheControl: 'no-cache',
});
