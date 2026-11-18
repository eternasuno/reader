import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

const DEFAULT_API_PORT = 3001;
const DEFAULT_WEB_PORT = 3000;

const ENV_DIR = '.';

export default defineConfig(({ mode }) => {
  const { API_PORT, WEB_PORT } = loadEnv(mode, ENV_DIR, [
    'API_PORT',
    'WEB_PORT',
  ]);
  const apiPort = Number(API_PORT) || DEFAULT_API_PORT;
  const port = Number(WEB_PORT) || DEFAULT_WEB_PORT;

  return {
    envDir: ENV_DIR,
    plugins: [
      solid({
        ssr: false,
        extensions: ['.jsx', '.tsx'],
      }),
      tailwindcss(),
    ],
    build: {
      outDir: 'dist/public',
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
    preview: {
      port,
    },
    resolve: {
      dedupe: ['vitest', '@effect/vitest'],
    },
    test: {
      environment: 'node',
      alias: [
        {
          find: /^solid-js$/,
          replacement: new URL(
            './dist/solid.js',
            import.meta.resolve('solid-js/package.json')
          ).pathname,
        },
      ],
    },
  };
});
