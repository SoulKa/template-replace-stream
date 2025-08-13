import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/*.test.ts"],
    alias: {
      "template-replace-stream": Boolean(process.env.CI) ? "dist" : __dirname,
    },
  },
});
