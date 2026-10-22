import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    globalSetup: ["./src/test/global-setup.ts"],
    // DB tests share one database and truncate between tests.
    fileParallelism: false,
    env: {
      OPENROUTER_API_KEY: "test-key",
    },
  },
});
