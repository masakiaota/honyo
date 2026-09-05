import { defineConfig } from 'vitest/config';
import { devNull } from 'node:os';

export default defineConfig({
  test: {
    outputFile: { blob: devNull },
    globals: true,
    environment: 'node',
    includeSource: ['src/**/*.{js,ts}'],
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
