import { HttpStaticServer } from 'effect/http';

export const staticRoutes = HttpStaticServer.layer({
  root: 'public',
  spa: true,
  cacheControl: 'no-cache',
});
