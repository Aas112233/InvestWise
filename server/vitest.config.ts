import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    exclude: ['src/__tests__/api-smoke.test.ts', 'node_modules', 'dist'],
  },
});
