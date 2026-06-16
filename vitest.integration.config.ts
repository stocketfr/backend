import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      src: path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['src/**/*.integration.spec.ts'],
    globals: true,
    environment: 'node',
    testTimeout: 15_000,
    hookTimeout: 30_000,
    globalSetup: './src/effect/testing/integration-global-setup.ts',
    setupFiles: ['./test/setup-env.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
