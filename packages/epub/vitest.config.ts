import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    dedupe: ['vitest', '@effect/vitest'],
  },
});
