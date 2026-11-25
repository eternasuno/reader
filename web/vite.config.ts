import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import solid from '@solidjs/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin, ResolvedConfig } from 'vite';
import { defineConfig } from 'vitest/config';

const SW_CACHE_PLACEHOLDER = "'__LANTERN_SW_CACHE__'";
const SW_MANIFEST_PLACEHOLDER = '/* __LANTERN_PRECACHE_URLS__ */ []';

interface DistEntry {
  url: string;
  bytes: Buffer;
}

const addDistEntry = (
  entries: Array<DistEntry>,
  fullPath: string,
  rel: string
): void => {
  if (rel === 'sw.js' || rel.endsWith('.map')) return;
  entries.push({
    url: rel === 'index.html' ? '/' : `/${rel}`,
    bytes: readFileSync(fullPath),
  });
};

const collectDistEntries = (dir: string, prefix = ''): Array<DistEntry> => {
  const entries: Array<DistEntry> = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${dirent.name}` : dirent.name;
    const fullPath = join(dir, dirent.name);
    if (dirent.isDirectory()) {
      entries.push(...collectDistEntries(fullPath, rel));
    } else if (dirent.isFile()) {
      addDistEntry(entries, fullPath, rel);
    }
  }
  return entries.sort((a, b) => a.url.localeCompare(b.url));
};

const writeSwManifest = (outDir: string): void => {
  const swPath = join(outDir, 'sw.js');
  const swBytes = readFileSync(swPath);
  const source = swBytes.toString('utf8');
  if (
    !source.includes(SW_CACHE_PLACEHOLDER) ||
    !source.includes(SW_MANIFEST_PLACEHOLDER)
  ) {
    throw new Error('sw.js is missing expected precache placeholders');
  }
  const entries = collectDistEntries(outDir);
  const hash = createHash('sha256');
  hash.update('sw.js\0');
  hash.update(swBytes);
  hash.update('\0');
  for (const entry of entries) {
    hash.update(entry.url);
    hash.update('\0');
    hash.update(entry.bytes);
    hash.update('\0');
  }
  const cacheName = `lantern-${hash.digest('hex').slice(0, 16)}`;
  const urls = entries.map((entry) => entry.url);
  const output = source
    .replace(SW_CACHE_PLACEHOLDER, JSON.stringify(cacheName))
    .replace(SW_MANIFEST_PLACEHOLDER, JSON.stringify(urls, null, 2));
  writeFileSync(swPath, output, 'utf8');
};

const swPrecachePlugin = (): Plugin => {
  let outDir = '';
  return {
    name: 'lantern-sw-precache',
    apply: 'build',
    configResolved(config: ResolvedConfig) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      writeSwManifest(outDir);
    },
  };
};

export default defineConfig({
  plugins: [tailwindcss(), solid(), swPrecachePlugin()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_TARGET ?? 'http://localhost:8080',
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
});
