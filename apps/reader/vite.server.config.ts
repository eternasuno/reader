import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    ssr: 'src/server/main.ts',
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'server.js',
      },
    },
  },
  ssr: {
    external: [
      '@mozilla/readability',
      'dompurify',
      'feedsmith',
      'fflate',
      'jsdom',
      'nodemailer',
      'puppeteer-core',
      'ws',
    ],
  },
  resolve: {
    dedupe: ['vitest', '@effect/vitest'],
  },
});
