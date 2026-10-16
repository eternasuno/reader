import tailwindcss from '@tailwindcss/vite';
import { loadEnv } from 'vite';
import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

const DEFAULT_PORT = 3000;
const ENV_DIR = '.';

export default defineConfig(({ mode }) => {
  const { WEB_PORT } = loadEnv(mode, ENV_DIR, 'WEB_PORT');
  const port = Number(WEB_PORT) || DEFAULT_PORT;

  return {
    envDir: ENV_DIR,
    plugins: [
      solid({
        ssr: false,
        extensions: ['.jsx', '.tsx'],
      }),
      tailwindcss(),
    ],
    server: {
      port,
      strictPort: true,
      proxy: {
        '/api': 'http://localhost:3001',
      },
    },
    preview: {
      port,
    },
    test: {
      environment: 'node',
      alias: {
        'solid-js': new URL(
          './dist/solid.js',
          import.meta.resolve('solid-js/package.json')
        ).pathname,
      },
    },
  };
});
