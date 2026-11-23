const CACHE_PREFIX = 'leaf-';
const CACHE = '__LEAF_SW_CACHE__';
const PRECACHE_URLS = /* __LEAF_PRECACHE_URLS__ */ [];
const PRECACHE_SET = new Set(PRECACHE_URLS);

const isCacheableBasic = (response) =>
  response.ok && response.type === 'basic' && !response.redirected;

const precacheAll = async () => {
  if (!CACHE.startsWith(CACHE_PREFIX) || PRECACHE_URLS.length === 0) {
    throw new Error('Service worker precache manifest is not initialized');
  }

  const pairs = await Promise.all(
    PRECACHE_URLS.map(async (url) => {
      const response = await fetch(url, {
        cache: 'reload',
        credentials: 'omit',
        redirect: 'error',
      });
      if (!isCacheableBasic(response)) {
        throw new Error(`Precache rejected for ${url}: ${response.status}`);
      }
      return [url, response];
    }),
  );

  const cache = await caches.open(CACHE);
  await Promise.all(pairs.map(([url, response]) => cache.put(url, response)));
};

const cacheFirst = async (request) => {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request, {
    credentials: 'omit',
    redirect: 'error',
  });
  if (isCacheableBasic(response)) {
    await cache.put(request, response.clone());
  }
  return response;
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    precacheAll().catch(async (error) => {
      if (CACHE.startsWith(CACHE_PREFIX)) {
        await caches.delete(CACHE);
      }
      throw error;
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
    return;
  }
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (
    url.pathname === '/api' ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/healthz'
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match('/')) ?? Response.error();
      }),
    );
    return;
  }

  if (
    url.pathname !== '/' &&
    url.search === '' &&
    !url.href.includes('?') &&
    PRECACHE_SET.has(url.pathname)
  ) {
    event.respondWith(cacheFirst(request));
  }
});
