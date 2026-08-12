import { defineConfig } from 'vitest/config';

// Zero runtime dependencies is a hard constraint (SPEC §0). Build tooling only.
export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
  worker: {
    format: 'es',
  },
  server: {
    fs: { allow: ['.'] },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
