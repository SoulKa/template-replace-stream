import { defineConfig } from 'vitest/config';
import path from 'path';

// If BUILD_DIST is set (e.g. in CI after building root project) resolve to dist, otherwise to source root.
const useDist = Boolean(process.env.BUILD_DIST);

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8'
    },
    alias: {
      'template-replace-stream': path.resolve(__dirname, useDist ? '../dist' : '..')
    }
  }
});
