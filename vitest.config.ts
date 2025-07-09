import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 15000,
    setupFiles: ['./src/test-setup.ts'],
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});