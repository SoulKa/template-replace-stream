import path from "node:path";
import { defineConfig } from "vitest/config";

const ROOT_DIR = __dirname;
const DIST_DIR = path.join(ROOT_DIR, "dist");

export default defineConfig({
  test: {
    alias: {
      "template-replace-stream":
        process.env.npm_lifecycle_event === "test:build" ? DIST_DIR : ROOT_DIR,
    },
    coverage: {
      include: ["index.ts"],
    },
  },
});
