import { defineConfig } from 'vitest/config';
import { versioning } from './tools/versioning.ts';

export default defineConfig({
  plugins: [versioning()],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  define: {
    __APP_VERSION__: JSON.stringify('test'),
    __APP_COMMIT__: JSON.stringify('test'),
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
