import path from "node:path";
import { defineConfig } from "vitest/config";

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, "dist");

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    alias: {
      "template-replace-stream":
        process.env.npm_lifecycle_event === "test:build"
          ? DIST_DIR
          : path.join(ROOT_DIR, "index.ts"),
    },
    coverage: {
      include: ["index.ts"],
    },
  },
});
