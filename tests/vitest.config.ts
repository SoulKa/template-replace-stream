import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
    },
    alias: {
      "template-replace-stream": path.resolve(__dirname, process.env.MODULE_DIR ?? ".."),
    },
  },
});
